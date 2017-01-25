'use strict';

var _ = require('lodash');
var fs = require('fs');
var Q = require('q');
var config = require('../../../config/environment');
var constants = require('../../../config/constants');
var handlebars = require('handlebars');
var wkhtmltopdf = require('wkhtmltopdf');
var orderQueries = require('../../../api/order/order.queries');
var stringDecoder = require('string_decoder').StringDecoder;
var errorHandling = require('../../errorHandling');

var CCLAddress = require('../../importer/ccl/ccl.consts').CCL_ADDRESS;
var TollAddress = require('../../importer/toll/const').TOLL_ADDRESS;

var TEMPLATEPATH = __dirname + '/template/uti_sli.html';

/**
 * Function to register all the handlebars helpers
 * @param data
 */
var handlebarsHelpers = function(data) {
    // Initializes order data. Call before each order
    handlebars.registerHelper('init', function() {
        var smeIndicator = _.get(data, 'additionalInfo.smeIndicator');
        var groupedLineItems = [];
        var composedLineItems = [];
        var totalValue = 0;

        _.forEach(_.get(data, 'orders'), function(order) {
            _.forEach(_.get(order, 'lineItems'), function(lineItem) {
                lineItem.smeIndicator = smeIndicator;
                lineItem.price = _.get(lineItem, 'price', 0) * _.get(lineItem, 'quantity', 0);
                lineItem.weight = _.get(lineItem, 'weight', 0) * _.get(lineItem, 'quantity', 0);

                // Transforming lineItem from mongoose to plain JSON
                groupedLineItems.push(lineItem.toObject());
            });
        });

        // Grouping line items by sku
        groupedLineItems = _.groupBy(groupedLineItems, 'sku');

        // Reducing each group to single element
        _.forEach(groupedLineItems, function(elements) {
            var composedLineItem = _.reduce(elements, function(result, element) {
                result.price += _.get(element, 'price', 0);
                result.weight += _.get(element, 'weight', 0);
                result.quantity += _.get(element, 'quantity', 0);

                return result;
            });

            var composedLineItemPrice = _.get(composedLineItem, 'price');

            composedLineItemPrice = Math.round(composedLineItemPrice);

            composedLineItems.push(_.omit(composedLineItem, '_id', '__v'));
            totalValue += composedLineItemPrice;
        });

        data.lineItems = composedLineItems;
        data.additionalInfo.declaredValueForCarriage = totalValue;
    });
};

var consignee = {
    CCL:   CCLAddress,
    TOLL:  TollAddress,
    EMPTY: {
        company:    '',
        streetName: '',
        houseNo:    '',
        postcode:   '',
        city:       '',
        country:    '',
    },
};

var countryToConsignee = {
    GB: consignee.CCL,
    AU: consignee.TOLL,
};

function getConsigneeByCountryCode(countryCode) {
    return _.get(countryToConsignee, countryCode, consignee.EMPTY);
}

/**
 * Extend order data with additionally important infos for uti's shippers letter.
 * @param ordersInBulk
 * @param bulk
 * @returns {*}
 */
var addData = function(ordersInBulk, bulk) {
    var instructionVarsByCountry = {
        GB: {
            airport:                'Heathrow',
            importer:               'CCL',
            importerPhone:          '+44 208 231 0900',
            borderGuruContactEmail: config.email.customerCare,
        },
        AU: {
            airport:                'Sydney',
            importer:               'Toll',
            importerPhone:          '+61 2 9364 5555',
            borderGuruContactEmail: config.email.customerCare,
        },
    };

    var instructionsTemplate = _.template(
        'In ${ airport }, ${ importer } is taking over this shipment: ${ importerPhone }. ' +
        'In case of any questions or issues at any time of the transport please ' +
        'contact BorderGuru by email ${ borderGuruContactEmail }.');

    var instruction = instructionsTemplate(_.get(instructionVarsByCountry,
        bulk.destinationCountry,
        instructionVarsByCountry['GB']));

    var outputData = {
        addresses:      {
            USPPI:                 constants.shippers.BorderGuruLLC,
            ultimateConsignee:     getConsigneeByCountryCode(bulk.destinationCountry), // 9
            intermediateConsignee: { // 11
                company:    'Direct',
                streetName: '',
                houseNo:    '',
                postcode:   '',
                city:       '',
                country:    '',
            },
        },
        additionalInfo: {
            transportMode:                   'Air', // 4 - [Air, Ocean, Road] => normally: CheckBox (fix)
            service:                         '', // 5 - [Temperature Sensitive] => normally: CheckBox (fix)
            forwardingAgent:                 'APC Postal Logistics', // 6 (fix)
            freightTerms:                    'Collect', // 7 - [Prepaid, Collect] => normally: CheckBox (fix)
            incoterms:                       'FAS', // 8 - [...] => normally: CheckBox (fix)
            ultimateConsigneeType:           'Direct Consumer', // 10 - [Direct Consumer, Government Entity, Reseller, Other/Unknown] => normally: CheckBox (fix)
            stateOfOrigin:                   'US', // 12 (fix)
            inBondCode:                      '', // 13
            USPPIReference:                  '', // 14
            countryOfUltimateDestination:    bulk.destinationCountry, // 15 (fix)
            entryNumber:                     '', // 16
            routedTransaction:               'No', // 17 - [Yes, No] => normally: CheckBox (fix)
            hazardousMaterial:               'No', // 18 - [Yes, No] => normally: CheckBox (fix)
            ftzIdentifier:                   '', // 19
            relatedPartyIndicator:           'Non-Related', // 20 - [Related, Non-Related] => normally: CheckBox (fix)
            tib_temporaryExport_carnet:      'No', // 21 - [Yes, No] => normally: CheckBox (fix)
            shippingWeightUnit:              'KG', // 25
            smeIndicator:                    'No', // 28
            instructionsToForwarder:         instruction,
            ddtcApplicantRegistrationNumber: 'n/a', // 32
            eligiblePartyCertification:      'No', // 33 - [Yes, No] => normally: CheckBox
            InsuranceRequested:              'No', // 34 - [Yes, No] => normally: CheckBox
            InsuranceRequestedValue:         '', // 34 b
            declaredValueForCarriage:        '', // 35 Summe aller line items (USD)
            USPPIContactName:                '', // 38
            signature:                       '', // 39
            USPPIemail:                      '', // 40
            title:                           '', // 41
            date:                            '', // 42
            USPPItelephone:                  '', // 43
            oceanFreightForwardingService:   '', // [LCL, FCL, 20', 40', 40' HC] => normally: CheckBox
            airServiceLevel:                 'Express', // [Next Flight Out, Express, Standard, Economy] => normally: CheckBox
            origin:                          'US',
        },
        orders:          ordersInBulk,
    };

    return Q.resolve(outputData);
};

/**
 * Function to render the export declaration for a bulk to PDF (based on hmtl templating)
 * @param bulk complete bulk
 * @returns {*}
 */
var createUtiSli = function(bulk) {
    var deferred = Q.defer();

    orderQueries.getAllOrdersInBulk(_.get(bulk, 'content'))
        .then(function(orders) {
            if (_.isEmpty(orders)) {
                var err = new Error(errorHandling.code.ERR_ORDER_NOT_FOUND.msg);

                return errorHandling.rejectDbErrPromise(deferred, err);
            }

            addData(orders, bulk)
                .then(function(inputData) {
                    handlebarsHelpers(inputData);

                    fs.readFile(TEMPLATEPATH, function(err, content) {
                        if (err) {
                            return deferred.reject(err);
                        }

                        var decoder = new stringDecoder('utf8');
                        var template = handlebars.compile(decoder.write(content));
                        var buffer = [];

                        var pdfStream = wkhtmltopdf(template(inputData), {
                            pageSize:    'A4',
                            orientation: 'Portrait',
                        });

                        pdfStream.on('data', function(d) {
                            buffer.push(d);
                        });

                        pdfStream.on('end', function() {
                            var result = {
                                filename: 'SLI_' + Date.now() + '.pdf',
                                data:     Buffer.concat(buffer),
                            };

                            deferred.resolve(result);
                        });

                        pdfStream.on('error', function(err) {
                            return deferred.reject(err);
                        });
                    });
                });
        }, function(err) {
            errorHandling.rejectDbErrPromise(deferred, err);
        })
        .fail(deferred.reject);

    return deferred.promise;
};

module.exports.createUtiSli = createUtiSli;
