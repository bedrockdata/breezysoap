(function () {

    "use strict";

    var root     = module.exports;

    var _        = require('underscore');
    var events   = require('events');
    var util     = require('util');
    var Promise  = require('promise');
    var path    = require('path');
    var fs      = require("fs");

    var request  = require('./request/request.js');

    var wsdl     = require('./wsdl.js');

    var _request = require('request');

    var wsdlGetPromise = [];
    /**
     * check if all needed data given
     * @param  {[type]}  params [description]
     * @return {Boolean}        [description]
     */
    function _isParamsComplete(params) {

        params = params || {};

        if (params.host === void 0 ||
            params.path === void 0 ||
            params.wsdl === void 0) {
            return false;
        }

        return true;
    }

    /**
     * check and correct params
     * @param  {[type]} params [description]
     * @return {[type]}        [description]
     */
    function _checkParams(params) {

        params = params || {};
        if (params.host.match('http://'))   params.host = params.host.substring(7);
        if (params.host.match('https://'))  params.host = params.host.substring(8);

        return params;
    }

    /**
     * initialize EasySoap
     * @param {[type]} params [description]
     * @param {[type]} opts   [description]
     */
    var EasySoap = function(params, opts) {

        opts = opts || {};
        if (false === (this instanceof EasySoap)) {
            return new EasySoap(params, opts);
        }

        events.EventEmitter.call(this);

        this.params     = params;
        this.opts       = opts;

        if (this.params.rejectUnauthorized === void 0) {
            this.params.rejectUnauthorized = true;
        }
    };

    //init events
    util.inherits(EasySoap, events.EventEmitter);

    EasySoap.prototype.getProtocol = function() {
        return (this.opts.secure === void 0 ||
                this.opts.secure === true) ? 'https://' : 'http://';
    }

    EasySoap.prototype.call = function(params, opts) {

        if (this.WSDL !== undefined && this.WSDL !== null && this.WSDL instanceof wsdl.Wsdl) {
            return this.doCall(params, opts);
        } else {
            var that = this;
            return new Promise(function(resolve, reject) {
                that.getWsdl().done(function (file) {
                    that.WSDL = new wsdl.Wsdl(file);
                    resolve(that.doCall(params, opts));
                }, function (error) {
                    reject(error);
                });
            });
        }
    };

    //do a soap call
    EasySoap.prototype.doCall = function(params, opts) {

        opts        = _.extend({}, this.opts, opts)     || this.opts;
        params      = _.extend({}, this.params, params) || this.params;

        var that = this;

        var req = new request.Request(params, opts);

        req.setWsdl(that.WSDL);

        var reqHeaders = req.getHeaders();
        var reqBody = req.prepare(params, opts);

        return new Promise(function(resolve, reject) {
            that.post(reqHeaders, reqBody).done(function(response) {

                var result = {
                    'data': that.WSDL.responseToArray(response.body, params.method),
                    'response': response
                }

                that.emit(params.method, result);

                resolve(result);
            });
        });
    };

    // do post request
    EasySoap.prototype.post = function(headers, body) {

        var that = this;

        return new Promise(function(resolve, reject) {

            _request({
                url                 : that.getProtocol() + that.params.host + that.params.path,
                body                : body,
                headers             : headers,
                rejectUnauthorized  : that.params.rejectUnauthorized,
                method              : 'POST'
            }, function(error, response, body) {
                if (error) {
                    reject(error);
                } else {
                    resolve({
                        'body'      : body,
                        'response'  : response,
                        'header'    : response.headers
                    });
                }
            });
        });
    };

    //do a get request
    EasySoap.prototype.get = function(params) {

        return new Promise(function (resolve, reject) {

            _request(params, function(error, response, body) {
                if (error) {
                    reject(error);
                } else {
                    resolve({
                        'body'      : body,
                        'response'  : response,
                        'header'    : response.headers
                    });
                }
            });
        });
    };

    EasySoap.prototype.getWsdl = function () {

        if (this.params.host === void 0 || this.params.wsdl === void 0) {
            throw new Error('insufficient arguments');
        }

        var params = {
            url: this.getProtocol() + this.params.host + this.params.wsdl,
            headers: this.params.headers || {},
            rejectUnauthorized  : this.params.rejectUnauthorized
        }

        var that = this;

        return new Promise(function(resolve, reject) {
            that.get(params).done(function(response) {
                if (response.response.statusCode !== 200) {
                    reject(new Error('Could not retrieve WSDL file ' + response.response.statusCode))
                } else {
                    resolve(response.body);
                }
            }, function(error) {
                reject(error);
            });
        });

    }


    //get all available functions from wsdl
    EasySoap.prototype.getAllFunctions = function() {
        if (this.wsdlClient === null) {
            this.emit('error', 'no wsdl initialized');
            return false;
        }

        return this.wsdlClient.getAllFunctions(this.wsdl);
    };

    root.Client = EasySoap;
    root.Request = request.Request;
    root.Wsdl = wsdl.Wsdl;

})();