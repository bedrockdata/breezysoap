(function() {

    "use strict";

    var that    = module.exports;

    var fs      = require('fs');
    var http    = require('http');
    var https   = require('https');

    var _       = require('underscore');
    var Promise = require('promise');
    var request = require('request');

    var util    = require('util');
    var events  = require('events');
    var path    = require('path');

    var wsdl    = require('../wsdl.js');

    var Request = function(params, opts) {

        if (false === (this instanceof Request)) {
            return new Request(params, opts);
        }

        events.EventEmitter.call(this);

        this.params     = params;
        this.opts       = opts;
    }


    //init events
    util.inherits(Request, events.EventEmitter);


    Request.prototype.setWsdl = function (wsdl) {
        this.wsdl = wsdl;
    };


    Request.prototype.getRequestEnvelope = function(callParams, namespaces, opts) {

        var that = this;

        callParams.soap = callParams.soap || {};

        var namespaceData = [];

        if (namespaces.indexOf("tns") === -1) {
            namespaceData.push(that.wsdl.getNamespaceByNs("tns", callParams, opts));
        }

        _.each(namespaces, function(namespace) {
            namespaceData.push(that.wsdl.getNamespaceByNs(namespace, callParams, opts));
        });

        if (callParams.header !== void 0) {
            _.each(callParams.header, function(headerItem, index) {
                namespaceData.push({
                    short : 'cns' + index,
                    full  : headerItem.namespace
                });
            });
        }

        return {
            soap_env    : callParams.soap.soap_env      || 'http://schemas.xmlsoap.org/soap/envelope/',
            xml_schema  : callParams.soap.xml_schema    || 'http://www.w3.org/2001/XMLSchema',
            namespaces  : namespaceData
        };
    }

    Request.prototype.getRequestHead = function(callParams, namespaces, opts) {
        callParams = callParams || {};

        if (callParams.header === void 0 || Object.keys(callParams.header).length === 0) {
            return null;
        }

        var headerParts = [];
        _.each(callParams.header, function(headerItem, index) {

            var item = '<cns' + index + ':' + headerItem.name + '>';
            item += headerItem.value;
            item += '</cns' + index + ':' + headerItem.name + '>';

            headerParts.push(item);
        });

        return headerParts;
    }

    Request.prototype.requestParamsFunc = function(name, params) {
        var that = this;

        if (_.isArray(params) && _.isObject(params)) {

            var returnValue = null;
            _.each(params, function(param) {
                if (returnValue === null) {
                    returnValue = that.requestParamsFunc(name, param);
                }
            });

            return returnValue;
        }

        if (name === params.name) {
            return params;
        }

        if (params.params === void 0) {
            return null;
        }

        return that.requestParamsFunc(name, params.params);
    }

    Request.prototype.requestItems = function(cParams, mParams, namespaces, namespace) {
        var that = this;

            namespace  = namespace || null;

            if (namespaces.indexOf(mParams.namespace) === -1) {
                if (mParams.namespace !== null) {
                    namespaces.push(mParams.namespace);
                }
            }

            var item = '';
            _.each(cParams, function(cParam, cParamName) {

                var methodItem = that.requestParamsFunc(cParamName, mParams);

                if (namespace === null &&
                    methodItem !== void 0 &&
                    methodItem !== null) {
                    namespace = methodItem.namespace;
                }

                if (namespaces.indexOf(namespace) === -1) {
                    if (namespace !== null) {
                        namespaces.push(namespace);
                    }
                }

                var namespace_string = '';
                if (namespace !== null && namespace !== 'xsd') {
                    namespace_string = namespace + ':';
                }

                var attributes = '';
                    if (_.isObject(cParam) && cParam._attributes) {
                    _.each(cParam._attributes, function(attrVal, attrKey) {
                        attributes += ' ' + attrKey + '="' + attrVal + '"';
                    });

                    cParam = cParam._value || null;
                }

                if (cParam === null) {
                    item += '<' + namespace_string + cParamName + attributes + ' />';
                }
                else {

                    if (_.isObject(cParam)) {

                        if (_.isArray(cParam)) {

                            _.each(cParam, function(cParamValue) {
                                item += '<' + namespace_string + cParamName + '>';
                                item += cParamValue;
                                item += '</' + namespace_string + cParamName + '>';
                            });
                        }
                        else {
                            item += '<' + namespace_string + cParamName + attributes + '>';
                            item += that.requestItems(cParam, mParams, namespaces, namespace);
                            item += '</' + namespace_string + cParamName + '>';
                        }
                    }
                    else {
                        item += '<' + namespace_string + cParamName + attributes + '>';
                        item += cParam;
                        item += '</' + namespace_string + cParamName + '>';
                    }
                }
            });

            return item;
        }


    Request.prototype.getTemplateParams = function(callParams, opts) {

        var namespaces = [];

        var methodParams = this.wsdl.getMethodParams(callParams.method);

        // adds items to the namespaces
        var requestParamString = this.requestItems(callParams.params, methodParams.request, namespaces);

        return {
            'envelope': this.getRequestEnvelope(callParams, namespaces, opts),
            'head': this.getRequestHead(callParams, namespaces, opts),
            'body': {
                'method': callParams.methodAlias || callParams.method,
                'params': requestParamString,
                'namespace': methodParams.request.namespace
            }
        }

    }


    Request.prototype.getTemplate = function (templateParams) {

        var template = _.template(fs.readFileSync(__dirname + path.sep + 'request.tpl', 'utf-8'));
        return template(templateParams);

    };


    Request.prototype.prepare = function(params, opts) {

        return this.getTemplate(this.getTemplateParams(params, opts));

    };


    Request.prototype.getHeaders = function() {

        return this.params.headers || {};

    };


    that.Request = Request;
})();
