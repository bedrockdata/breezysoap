(function() {

    "use strict";

    var that    = module.exports;

    var fs      = require("fs");
    var util    = require('util');
    var events  = require('events');
    var path    = require('path');
    var url     = require('url');

    var Promise = require('promise');
    var xmldoc  = require('xmldoc');
    var _       = require('underscore');

    var request = require('./request/request.js');

    var wsdlGetPromise = [];

    var Wsdl = function(wsdl) {

        if (false === (this instanceof Wsdl)) {
            return new Wsdl(wsdl);
        }

        events.EventEmitter.call(this);

        try {
            this.wsdlObj = new xmldoc.XmlDocument(wsdl);

            this.portTypes = this.searchNode(this.wsdlObj, 'portType');
            this.messages = this.searchNode(this.wsdlObj, 'message');
            this.types = this.searchNode(this.wsdlObj, 'types');

            this.operations = this.searchNode(this.portTypes[0], 'operation');
            this.schema = this.searchNode(this.types[0], 'schema');
        } catch (error) {
            console.log(error);
            return new Error(error);
        }

    }

    //init events
    util.inherits(Wsdl, events.EventEmitter);

    Wsdl.prototype.isValid = function() {
        if (this.wsdlObj === null || this.wsdlObj === void 0) {
            return false
        } else {
            return true
        }
    }

    //privates
    Wsdl.prototype.getName = function (name) {
        if (name === null || name === void 0) {
            return null
        }

        var attr = name.split(':');
        if (attr.length > 1) {
            return attr[1];
        }

        return name;
    }

    Wsdl.prototype.getNamespace = function (name) {
        if (name === null || name === void 0) {
            return null
        }

        var attr = name.split(':');
        if (attr.length > 1) {
            return attr[0];
        }

        return name;
    }

    Wsdl.prototype.getNamespaceByAttr = function (nsAttr, wsdlObj) {
        var that = this;

        var data;
        _(wsdlObj.attr).each(function(value, key) {
            if (that.getName(key) === that.getNamespace(nsAttr)) {
                data = value;
            }
        });

        return data;
    }

    Wsdl.prototype.getParams = function(node, method, messages, methodAttrName) {
        var params = [];

        var elements    = [];

        var that = this;

        var methodNode  = that.searchNodeByNameRecursive(node, method);

        if (methodNode === void 0 && methodAttrName !== void 0) {
            _.each(messages, function(message) {
                if (message.attr.name === methodAttrName) {
                    methodNode = message;
                }
            });

            _.each(methodNode.children, function(child) {
                elements.push(child);
            });

        } else {
            if (methodNode !== void 0) {
                elements = that.searchNode(methodNode, 'element');
            }
        }

        if (elements === false || elements === null || elements.length === 0) {
            return {};
        }

        _.each(elements, function(element) {
            var paramType = element.attr.type || element.attr.element || null;

            var item = {
                'name'      : element.attr.name,
                'namespace' : that.getNamespace(paramType),
                'mandatory' : (element.attr.minOccurs > 0) ? true : false,
                'type'      : that.getName(paramType)
            };

            var subParams = that.getParams(node, that.getName(paramType), messages);
            if (Object.keys(subParams).length !== 0) {
                item.params = subParams;
            }

            params.push(item);
        });

        return params;
    };

    Wsdl.prototype.searchNodeByAttribute = function (node, value, attribute) {
        if (node === void 0)        throw new Error('no node');
        if (value === void 0)       throw new Error('no value');
        if (attribute === void 0)   throw new Error('no attribute');

        return node.childWithAttribute(attribute, value);
    }

    Wsdl.prototype.searchNodeByName = function (node, name) {
        return this.searchNodeByAttribute(node, name, 'name');
    }

    Wsdl.prototype.searchNodeByNameRecursive = function (node, name) {
        var that = this;

        var targetNode = that.searchNodeByName(node, name);
        if (targetNode !== void 0) {
            return targetNode;
        }

        if (!node ||
            node.children === void 0 ||
            node.children.length === 0) {
            return false;
        }

        _.each(node.children, function(child) {

            var searchResult = that.searchNodeByNameRecursive(child, name);
            if (searchResult !== false && searchResult !== void 0) {
                targetNode = searchResult;
            }
        });

        return targetNode;
    }


    Wsdl.prototype.searchNode = function (node, name) {
        var that = this;

        if (name === void 0) throw new Error('no name');
        if (!node ||
            node.children === void 0 ||
            node.children === null   ||
            _.isEmpty(node.children)) {
            return false;
        }

        var target_node = null;
        _(node.children).each(function(node_children) {

            if (target_node !== null) return true;

            var childrens = null;
            if (name == that.getName(node_children.name)) {
                childrens = node.childrenNamed(node_children.name);
            }

            if (childrens === null) {
                childrens = that.searchNode(node_children, name);
            }

            if (childrens !== null &&
                childrens !== false) {
                target_node = childrens;
            }
        });

        return target_node;
    }

    Wsdl.prototype.nodeDataExtract = function (node) {
        var data = {};
        var that = this;

        if (node.children === void 0 || node.children.length === 0) {
            if (node.attr !== void 0 && !_.isEmpty(node.attr)) {
                return {
                    '_attributes' : node.attr,
                    '_value'      : node.val
                };
            }

            return node.val ;
        }

        _(node.children).each(function(child) {

            if (child.children !== void 0 && child.children.length !== 0) {

                var childToExtract = child;
                if (child.children.length === 1) {
                    if (child.children[0].name === that.getName(child.name)) {
                        childToExtract = child.children[0];
                    }

                    if (childToExtract.attr !== void 0 && !_.isEmpty(childToExtract.attr)) {
                        var res = _.extend(
                            {'_attributes': childToExtract.attr},
                            that.nodeDataExtract(childToExtract, node.name)
                        );

                        if (_.isArray(data[that.getName(child.name)])) {
                            data[that.getName(child.name)].push(res);
                        } else if (_.isObject(data[that.getName(child.name)])) {
                            var tmp = data[that.getName(child.name)];
                            data[that.getName(child.name)] = [];
                            data[that.getName(child.name)].push(tmp);
                            data[that.getName(child.name)].push(res);
                        } else {
                            data[that.getName(child.name)] = res;
                        }
                    } else {
                        data[that.getName(child.name)] = that.nodeDataExtract(childToExtract);
                    }
                } else {

                    if (!_.isArray(data[that.getName(child.name)])) {
                        if (_.isObject(data[that.getName(child.name)])) {
                            var tmp = data[that.getName(child.name)];
                            data[that.getName(child.name)] = [];
                            data[that.getName(child.name)].push(tmp);
                        } else {
                            data[that.getName(child.name)] = [];
                        }
                    }

                    if (childToExtract.attr !== void 0 && !_.isEmpty(childToExtract.attr)) {
                        data[that.getName(child.name)].push({
                            '_attributes'   : childToExtract.attr,
                            '_value'        : that.nodeDataExtract(childToExtract, node.name)
                        });
                    } else {
                        data[that.getName(child.name)].push(that.nodeDataExtract(childToExtract, node.name));
                        if (_.isArray(data[that.getName(child.name)])) {
                            if (data[that.getName(child.name)].length === 1) {
                                data[that.getName(child.name)] = data[that.getName(child.name)][0];
                            }
                        }
                    }
                }
            } else {
                if (data[that.getName(child.name)] !== void 0) {
                    if (!_.isArray(data[that.getName(child.name)])) {
                        var tmp = data[that.getName(child.name)];
                        data[that.getName(child.name)] = [];
                        data[that.getName(child.name)].push(tmp);
                    }
                    data[that.getName(child.name)].push(that.nodeDataExtract(child, node.name));
                } else {
                    data[that.getName(child.name)] = that.nodeDataExtract(child, node.name);
                }
            }
        });



        return data;
    }


    Wsdl.prototype.getWsdl = function (params, opts) {

        params  = _.extend({}, params) || {};
        opts    = opts   || {};

        var cacheFileName = params.host + params.wsdl;
            cacheFileName = cacheFileName.replace(/[^a-zA-Z 0-9]+/g, "");
            cacheFileName = encodeURIComponent(cacheFileName);

        if (wsdlGetPromise[cacheFileName] === void 0) {
            wsdlGetPromise[cacheFileName] = new Promise(function(resolve, reject) {

                if (params.host === void 0 ||
                    params.wsdl === void 0) {
                    throw new Error('insufficient arguments');
                }

                var fullPath = __dirname +  path.sep + '..' +
                                            path.sep + 'cache' +
                                            path.sep + cacheFileName;

                var refresh = true;
                if (fs.existsSync(fullPath)) {
                    refresh = false;
                    var fileStat = fs.statSync(fullPath);
                    if (Date.now() - new Date(fileStat.mtime).getTime() >= 84000000) {
                        refresh = true;
                    }
                }

                if (refresh === false) {
                    resolve(fs.readFileSync(fullPath, 'UTF-8'));
                }
                else {

                    params.path = params.wsdl;

                    request.get(params, opts)
                        .done(function(res) {
                            fs.writeFile(fullPath, res.body, function(err) {
                                if (err) {
                                    reject(err);
                                    return;
                                }
                                resolve(res.body);
                            });
                        },
                        function(err) {
                            reject(err);
                        });
                }
            });
        }

        return wsdlGetPromise[cacheFileName];
    }

    Wsdl.prototype.getMethodParams = function(method) {
        try {

            var methodName = this.searchNodeByName(this.portTypes[0], method);

            var methodRequest = this.searchNode(methodName, 'input')[0];
            var methodResponse = this.searchNode(methodName, 'output')[0];

            var reqName = this.getName(methodRequest.attr.message);
            var resName = this.getName(methodResponse.attr.message);

        } catch (error) {

            return error;

        }

        return {
            request: {
                namespace: this.getNamespace(methodRequest.attr.message),
                name: reqName,
                params: this.getParams(this.types[0], method, this.messages, reqName)
            },

            response: {
                namespace: this.getNamespace(methodResponse.attr.message),
                name: resName,
                params: this.getParams(this.types[0], method, this.messages, resName)
            }
        };

    };

    Wsdl.prototype.getNamespaceByNs = function(ns, params, opts) {
        return {
            short: ns,
            full: this.getNamespaceByAttr(ns, this.wsdlObj)
        }
    };

    Wsdl.prototype.responseToArray = function(response, method) {

        var methodData = this.getMethodParams(method);

        try {
            var response_xml = new xmldoc.XmlDocument(response);
            var response_body = this.searchNode(response_xml, 'Body')[0];
        } catch (error) {
            return '';
        }

        if (response_body.children.length === 1) {
            if (this.getName(response_body.children[0].name) === methodData.response.name) {
                response_body = response_body.children[0];
            }
        }

        var data = this.nodeDataExtract(response_body);

        if (data[methodData.response.name] === void 0) {
            return data;
        }

        if (data[methodData.response.name].length === 1) {
            return data[methodData.response.name][0];
        }

        return data[methodData.response.name];
    };

    Wsdl.prototype.requestCheck = function(params, opts) {
        var that = this;

        opts = opts || {};

        if (params.method === void 0) throw new Error('no method');

        var checkedParams = {};
        _.each(params.params, function(data, value) {
            checkedParams[that.getName(value)] = data;
        });


        var methodData = that.getMethodParams(params.method);

        //check namespace
        if (methodData.request.namespace !== void 0) {
            if (params.namespace === void 0) {
                params.namespace = methodData.request.namespace;
            }
        }

        //check params
        _(methodData.request.params).each(function(param) {
            if (param.mandatory === true) {
                if (!_.has(checkedParams, that.getName(param.name))) {
                    throw new Error('mandatory ' + param.name + ' not given');
                }
            }
        });
    };

    Wsdl.prototype.getAllFunctions = function() {
        var messages = this.searchNode(this.wsdlObj, 'message');
        var functions = [];
        _(messages).each(function(message) {
            functions.push(message.attr.name);
        });

        return functions;
    };

    that.Wsdl = Wsdl;

})();
