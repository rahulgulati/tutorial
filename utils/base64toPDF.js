/*
Convert Base64 to PDF
node base64toPDF.js source destination
*/
var myArgs = process.argv.slice(2);
var fs = require('fs');
var path = require('path');
var filePath = path.join(__dirname, myArgs[0]);
fs.readFile(filePath, function(err,data){
	if (err) {
   		return console.log('Error: ' + err);
	}
	const x = new Buffer(data.toString(), 'base64');
	fs.writeFileSync(myArgs[1]+'.pdf', x);
});