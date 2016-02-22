'use strict';
var Promise = require('bluebird');
var xml2js = require('xml2js');
var fs = require('fs');
var sax         = require('sax');
var saxpath = require('saxpath');
var GJV = require('geojson-validation');
var proj4 = require('proj4');
var reproject = require('reproject');
var jsts = require('jsts');
var reader = new jsts.io.GeoJSONReader();

module.exports = {
  title: 'BAG',
  url: 'http://bag.kadaster.nl',
  extractBuildingsFromFile: extractBuildingsFromFile,
  validateCoords: validateCoords,
  joinGMLposlist: joinGMLposlist,
  isValidGeoJSON: isValidGeoJSON,
  toWGS84: toWGS84
};

function extractBuildingsFromFile(inputFileName, callback) {
  console.log(`Processing ${inputFileName}`);
  var buildings = [];
  var parser = new xml2js.Parser();
  var strict = true;

  var saxStream = sax.createStream(strict);
  fs.createReadStream(inputFileName, { encoding: 'utf8' })
    .pipe(saxStream);

  var streamer   = new saxpath.SaXPath(saxStream, '//bag_LVC:Pand');

  streamer.on('match', xml => {
    parser.parseString(xml, (err, result) => {
      if (err) {
        console.error(`Error parsing xml element ${xml} \n ${err.stack}`);
        return callback(err);
      }

      joinGMLposlist(result['bag_LVC:Pand']['bag_LVC:pandGeometrie'][0]['gml:Polygon'][0]['gml:exterior'][0]['gml:LinearRing'][0]['gml:posList'][0]._)
        .then(list => {
          var polygon = [];
          polygon[0] = list;

          buildings.push({
            uri: module.exports.url + '/pand/' + result['bag_LVC:Pand']['bag_LVC:identificatie'][0],
            id: result['bag_LVC:Pand']['bag_LVC:identificatie'][0],
            bouwjaar: result['bag_LVC:Pand']['bag_LVC:bouwjaar'][0],
            geometry: {
              type: 'Polygon',
              coordinates: polygon
            }
          });
        });

    });
  });

  saxStream.on('error', err => {
    console.error(`saxStream threw error ${err.stack}`);

    // clear the error
    this._parser.error = null;
    this._parser.resume();
  });

  saxStream.on('end', () => {
    console.log(`Returning ${buildings.length} buildings from ${inputFileName}`);
    return callback(null, buildings);
  });

}

function joinGMLposlist(posList, type) {
  return new Promise((resolve, reject) => {
    posList = posList.split(' ');

    var geojsonPosList = [];
    var counter = 0;

    while (posList.length !== 0) {
      var point = [];
      point.push(parseFloat(posList.shift()));
      point.push(parseFloat(posList.shift()));
      posList.shift(); // skip 3d height
      point = toWGS84(point)
        .map(coordinate => parseFloat(
          coordinate.toFixed(7))
        );
      geojsonPosList[counter] = point;

      counter += 1;
    }

    if (type === 'Polygon') {
      //add extra level of array
      var extralevel = [[[]]];
      extralevel[0] = geojsonPosList;
      resolve(extralevel);
    }

    resolve(geojsonPosList);

  });
}

function validateCoords(geojsoncoords, type) {
  return new Promise((resolve, reject) => {
    var geojson = {
      type: 'Feature',
      geometry: {
        type: type,
        coordinates: geojsoncoords
      },
      properties: {}
    };

    GJV.isFeature(geojson, (valid, errs) => {
      if (!valid) {
        console.error('Validator rejecting geometry due to:', errs);
        reject(errs);
      } else {
        console.log('JSTS evaluated feature as valid: ' + isValidGeoJSON(geojson) + '\n');
        resolve(isValidGeoJSON(geojson));
      }
    });
  });
}

function isValidGeoJSON(geoJSONPolygon) {
  var jstsGeometry  = reader.read(geoJSONPolygon.geometry);

  if (jstsGeometry) {
    var validator = new jsts.operation.valid.IsValidOp(jstsGeometry);
    return validator.isValid();
  }
}

function toWGS84(point) {
  var EPSG28992 = '+proj=sterea +lat_0=52.15616055555555 +lon_0=5.38763888888889 +k=0.9999079 +x_0=155000 +y_0=463000 +ellps=bessel +towgs84=565.417,50.3319,465.552,-0.398957,0.343988,-1.8774,4.0725 +units=m +no_defs';

  return proj4(
    EPSG28992,
    proj4('WGS84')
  ).forward(point);
}