'use strict';

var Consts = require('./uti.consts');
var utisli = require('./utisli.util');
var FilePersistence = require('../../filePersistence');
var Logger = require('../../../components/logger/logger');
var Exporter = require('./../exporter');
var Q = require('q');


var Uti = Object.create(Exporter);

Uti.createFiles = function(bulk, orders, req) {
    var deferred = Q.defer();
    bulk.mawb = req.body.mawbNumber;
    utisli.createUtiSli(bulk)
    .then(function (sliResult) {
        var fileTarget = Consts.BULKING_FILE_TARGETS.BULKING_HERMES_UTISLI_TARGET;
        var refCollection = Consts.BULKING_REFCOLLECTIONS.BULKING_HERMES_UTISLI_REF;

        bulk.files.utisli.filename = sliResult.filename;
        bulk.files.utisli.target = fileTarget; // important! do not change this! required for config!

        // finish creating bulk files
        bulk.filesCreatedAt = Date.now();
        bulk.filesCreated = true;

        return FilePersistence.persistFile(sliResult.filename, sliResult.data, refCollection, bulk._id);
    })
    .then(function(fileId){
        Logger.debug(Logger.categories.BULKING, 'File '+ bulk.files.utisli.filename +' persisted with id ' + fileId);
        bulk.files.utisli.fileId = fileId;

        Logger.debug(Logger.categories.BULKING, 'UTi SLI for  MAWB "'+ bulk.mawb + '" create successfully');
        deferred.resolve(bulk);
    })
    // no callback for upload, response already sent!
    .fail(function (err) {
        Logger.warn(Logger.categories.BULKING,('Error in creating UTi SLI: ' + err), err);
        deferred.reject(err);
    });
    return deferred.promise;
};

Uti.sendFiles = function (bulk) {
   return Q.resolve(bulk);
};

module.exports = Uti;
