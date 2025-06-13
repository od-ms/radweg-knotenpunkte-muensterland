const originalInitTile = L.GridLayer.prototype._initTile;
if (!originalInitTile.isPatched) {
  L.GridLayer.include({
    _initTile: function(tile) {
      originalInitTile.call(this, tile);

      const tileSize = this.getTileSize();

      tile.style.width = tileSize.x + 1 + 'px';
      tile.style.height = tileSize.y + 1 + 'px';
    },
  });

  L.GridLayer.prototype._initTile.isPatched = true;
}

(function(window, document, undefined) {
  L.Control.ZoomIndicator = L.Control.extend({
    options: {
      position: 'topleft',
      enabled: true,
    },

    onAdd: function(map) {
      const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-zoom-indicator');
      this._link = L.DomUtil.create('a', '', container);
      this._link.innerHTML = map.getZoom();
      map.on(
        'zoomend',
        function() {
          this._link.innerHTML = map.getZoom();
        },
        this,
      );

      return container;
    },
  });
})(this, document);

const map = L.map('map', {
  center: [45, 0],
  zoom: 3,
  worldCopyJump: true,
  // maxBounds: [
  //   [-85, -180],
  //   [85, 180]
  // ],
  attributionControl: false,
});

map.addControl(new L.Control.ZoomIndicator());

// const defs = window.GeoPackage.proj4Defs;
// for (const name in defs) {
//   if (defs[name]) {
//     window.proj4.defs(name, defs[name]);
//   }
// }

const osm = L.tileLayer('https://osm-{s}.gs.mil/tiles/default/{z}/{x}/{y}.png', {
  subdomains: '1234',
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> <strong>',
});
const arcworldmap = L.tileLayer(
  'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}.png',
  {
    attribution:
      'Source: Esri, DigitalGlobe, GeoEye, Earthstar Geographics, CNES/Airbus DS, USDA, USGS, AeroGRID, IGN, and the GIS User Community',
  },
);
map.addControl(
  L.control.basemaps({
    basemaps: [osm, arcworldmap],
    tileX: 0,
    tileY: 0,
    tileZ: 1,
  }),
);

let geoPackage;
let tableLayers;
let featureLayers;
let imageOverlay;
let currentTile = {};
let tableInfos;
let fileName;
let closestLayer;

function toRadians(degrees) {
  return degrees * (Math.PI / 180.0);
}

function getTileFromPoint(latlng) {
  const xtile = parseInt(Math.floor(((latlng.lng + 180) / 360) * (1 << map.getZoom())));
  const ytile = parseInt(
    Math.floor(
      ((1 - Math.log(Math.tan(toRadians(latlng.lat)) + 1 / Math.cos(toRadians(latlng.lat))) / Math.PI) / 2) *
        (1 << map.getZoom()),
    ),
  );
  return {
    z: map.getZoom(),
    x: xtile,
    y: ytile,
  };
}

function mapClickEventHandler(event) {
  if (closestLayer) {
    map.removeLayer(closestLayer);
  }
  const latitude = event.latlng.lat;
  const longitude = event.latlng.lng;
  const { x, y, z } = getTileFromPoint(event.latlng);
  const closestFeatures = [];
  for (const featureTable in featureLayers) {
    const cf = geoPackage.getClosestFeatureInXYZTile(featureTable, x, y, z, latitude, longitude);
    if (cf) closestFeatures.push(cf);
  }
  console.log('closest', closestFeatures);
  closestFeatures.sort(function(first, second) {
    if (first.coverage && second.coverage) return 0;
    if (first.coverage) return 1;
    if (second.coverage) return -1;
    return first.distance - second.distance;
  });
  if (closestFeatures.length) {
    let popup;
    closestLayer = L.geoJSON(closestFeatures[0], {
      onEachFeature: function(feature, layer) {
        let geojsonPopupHtml = '<div class="geojson-popup"><h6>' + feature.gp_table + '</h6>';
        if (feature.coverage) {
          geojsonPopupHtml += 'There are ' + feature.feature_count + ' features in this area.';
        } else {
          geojsonPopupHtml += '<table>';
          for (const property in feature.properties) {
            geojsonPopupHtml +=
              '<tr><td class="title">' +
              property +
              '</td><td class="text">' +
              feature.properties[property] +
              '</td></tr>';
          }
          geojsonPopupHtml += '</table>';
        }
        geojsonPopupHtml += '</div>';
        popup = layer.bindPopup(geojsonPopupHtml, {
          maxHeight: 300,
        });
      },
    });
    map.addLayer(closestLayer);
    popup.openPopup();
  }
  return closestFeatures;
}

map.on('click', mapClickEventHandler);

window.saveGeoPackage = async function() {
  const data = await geoPackage.export();
  fileName = fileName || 'geopackage.gpkg';
  const blob = new Blob([data.buffer], { type: 'octet/stream' });
  FileSaver.saveAs(blob, fileName.substring(0, fileName.lastIndexOf('.')) + '.gpkg');
};

window.downloadGeoJSON = function(tableName) {
  const converter = new GeoJSONToGeoPackage();
  converter.extract(geoPackage, tableName).then(function(geoJson) {
    const blob = new Blob([JSON.stringify(geoJson)], { type: 'data:text/json;charset=utf-8' });
    FileSaver.saveAs(blob, tableName + '.geojson');
  });
};

function clearInfo() {
  const tileTableNode = $('#tile-tables');
  tileTableNode.empty();
  const featureTableNode = $('#feature-tables');
  featureTableNode.empty();

  for (layerName in tableLayers) {
    map.removeLayer(tableLayers[layerName]);
  }
  tableLayers = {};
  featureLayers = {};
  if (imageOverlay) {
    map.removeLayer(imageOverlay);
  }
  $('#information')
    .removeClass('hidden')
    .addClass('visible');
}

function readGeoPackage(geoPackage) {
  tableInfos = {};
  const featureTableTemplate = $('#feature-table-template').html();
  Mustache.parse(featureTableTemplate);

  const tileTableTemplate = $('#tile-table-template').html();
  Mustache.parse(tileTableTemplate);

  const tileTableNode = $('#tile-tables');
  const featureTableNode = $('#feature-tables');

  const tileTables = geoPackage.getTileTables();
  tileTables.forEach(function(table) {
    const tileDao = geoPackage.getTileDao(table);
    const info = geoPackage.getInfoForTable(tileDao);
    tableInfos[table] = info;
    const rendered = Mustache.render(tileTableTemplate, info);
    tileTableNode.append(rendered);
  });
  const featureTables = geoPackage.getFeatureTables();
  featureTables.forEach(function(table) {
    try {
      const featureDao = geoPackage.getFeatureDao(table);
      const info = geoPackage.getInfoForTable(featureDao);
      tableInfos[table] = info;
      const rendered = Mustache.render(featureTableTemplate, info);
      featureTableNode.append(rendered);
    } catch (err) {
      console.log('Error opening table ' + table, err);
    }
  });
}

function handleGeoJSONByteArray(array, geoJsonDoneCallback) {
  if (window.Piwik) {
    Piwik.getAsyncTracker().trackEvent('GeoJSON', 'load', 'File Size', array.byteLength);
  }
  ga('send', {
    hitType: 'event',
    eventCategory: 'GeoJSON',
    eventAction: 'load',
    eventLabel: 'File Size',
    eventValue: array.byteLength,
  });
  let jsonString = '';
  const len = array.byteLength;
  for (let i = 0; i < len; i++) {
    jsonString += String.fromCharCode(array[i]);
  }
  const json = JSON.parse(jsonString);
  const converter = new GeoJSONToGeoPackage();
  converter
    .convert(
      {
        geoJson: json,
      },
      function(status) {
        let text = status.status;
        if (status.completed) {
          text +=
            ' - ' +
            ((status.completed / status.total) * 100).toFixed(2) +
            ' (' +
            status.completed +
            ' of ' +
            status.total +
            ')';
        }
        $('#status').text(text);
        return new Promise(function(resolve, reject) {
          setTimeout(function() {
            resolve();
          }, 0);
        });
      },
    )
    .then(function(gp) {
      geoPackage = gp;
      clearInfo();
      readGeoPackage(gp);
      geoJsonDoneCallback ? geoJsonDoneCallback() : null;
    });
}

function handleXYZZipByteArray(array, xyzZipDoneCallback) {
  if (window.Piwik) {
    Piwik.getAsyncTracker().trackEvent('XYZ Zip', 'load', 'File Size', array.byteLength);
  }
  ga('send', {
    hitType: 'event',
    eventCategory: 'XYZ Zip',
    eventAction: 'load',
    eventLabel: 'File Size',
    eventValue: array.byteLength,
  });
  new XYZToGeoPackage()
    .convert(
      {
        xyzZipData: array,
      },
      function() {
        return Promise.resolve();
      },
    )
    .then(function(gp) {
      console.log('here')
      geoPackage = gp;
      clearInfo();
      readGeoPackage(gp);
      xyzZipDoneCallback ? xyzZipDoneCallback() : null;
    });
}


function handleShapefileZipByteArray(array, shapefileZipDoneCallback) {
  if (window.Piwik) {
    Piwik.getAsyncTracker().trackEvent('Shapefile Zip', 'load', 'File Size', array.byteLength);
  }
  ga('send', {
    hitType: 'event',
    eventCategory: 'Shapefile Zip',
    eventAction: 'load',
    eventLabel: 'File Size',
    eventValue: array.byteLength,
  });
  new ShapefileToGeoPackage()
    .convert(
      {
        shapezipData: array,
      },
      function(status) {
        let text = status.status;
        if (status.completed) {
          text +=
            ' - ' +
            ((status.completed / status.total) * 100).toFixed(2) +
            ' (' +
            status.completed +
            ' of ' +
            status.total +
            ')';
        }
        $('#status').text(text);
        return Promise.resolve();
      },
    )
    .then(function(gp) {
      geoPackage = gp;
      clearInfo();
      readGeoPackage(gp);
      shapefileZipDoneCallback ? shapefileZipDoneCallback() : null;
    });
}

function loadByteArray(array, callback) {
  clearInfo();

  return window.GeoPackage.GeoPackageAPI.open(array).then(function(gp) {
    geoPackage = gp;
    readGeoPackage(gp);
  });
}

window.loadGeoPackage = function(files) {
  const f = files[0];
  fileName = f.name;
  console.log(fileName)
  $('#choose-label')
    .find('i')
    .toggle();
  $('#choose-label')
    .find('span')
    .text(f.name);
  $('#status').removeClass('gone');

  const r = new FileReader();
  r.onload = function() {
    const array = new Uint8Array(r.result);

    // if it is a GeoPackage file
    if (f.name.lastIndexOf('gpkg') === f.name.lastIndexOf('.') + 1) {
      if (window.Piwik) {
        Piwik.getAsyncTracker().trackEvent('GeoPackage', 'load', 'File Size', array.byteLength);
      }
      ga('send', {
        hitType: 'event',
        eventCategory: 'GeoPackage',
        eventAction: 'load',
        eventLabel: 'File Size',
        eventValue: array.byteLength,
      });
      loadByteArray(array).then(function() {
        $('#choose-label')
          .find('i')
          .toggle();
        $('#download').removeClass('gone');
        $('#status').addClass('gone');
      });
    }
    // if it is a GeoJSON file
    else if (f.name.lastIndexOf('json') > f.name.lastIndexOf('.')) {
      handleGeoJSONByteArray(array, function() {
        $('#choose-label')
          .find('i')
          .toggle();
        $('#download').removeClass('gone');
        $('#status').addClass('gone');
      });
    }
    // if it is a Shapefile or XYZ zip
    else if (f.name.lastIndexOf('zip') > f.name.lastIndexOf('.')) {
      // TODO: determine if this zip is a shapefile zip or a tiles zip
      new window.jszip().loadAsync(array).then(zip => {
        const shpfileArray = zip.filter(function(relativePath) {
          return relativePath.endsWith('.shp');
        });
        if (shpfileArray.length > 0) {
          handleShapefileZipByteArray(array, function() {
            $('#choose-label')
              .find('i')
              .toggle();
            $('#download').removeClass('gone');
            $('#status').addClass('gone');
          });
        } else {
          handleXYZZipByteArray(array, function() {
            $('#choose-label')
              .find('i')
              .toggle();
            $('#download').removeClass('gone');
            $('#status').addClass('gone');
          });
        }
      })
    }
    // if it is a Shapefile shp
    else if (f.name.lastIndexOf('shp') > f.name.lastIndexOf('.')) {
      if (window.Piwik) {
        Piwik.getAsyncTracker().trackEvent('Shapefile', 'load', 'File Size', array.byteLength);
      }
      ga('send', {
        hitType: 'event',
        eventCategory: 'Shapefile',
        eventAction: 'load',
        eventLabel: 'File Size',
        eventValue: array.byteLength,
      });
      ShapefileToGeoPackage.convert(
        {
          shapeData: array,
        },
        function(status) {
          let text = status.status;
          if (status.completed) {
            text +=
              ' - ' +
              ((status.completed / status.total) * 100).toFixed(2) +
              ' (' +
              status.completed +
              ' of ' +
              status.total +
              ')';
          }
          $('#status').text(text);
        },
        function(err, gp) {
          geoPackage = gp;
          clearInfo();
          readGeoPackage(gp);
          $('#choose-label')
            .find('i')
            .toggle();
          $('#download').removeClass('gone');
          $('#status').addClass('gone');
        },
      );
    }
    // if it is a MBTiles file
    else if (f.name.lastIndexOf('mbtiles') > f.name.lastIndexOf('.')) {
      if (window.Piwik) {
        Piwik.getAsyncTracker().trackEvent('MBTiles', 'load', 'File Size', array.byteLength);
      }
      ga('send', {
        hitType: 'event',
        eventCategory: 'MBTiles',
        eventAction: 'load',
        eventLabel: 'File Size',
        eventValue: array.byteLength,
      });
      new MBTilesToGeoPackage()
        .convert(
          {
            mbtilesData: array,
          },
          function(status) {
            let text = status.status;
            if (status.completed) {
              text +=
                ' - ' +
                ((status.completed / status.total) * 100).toFixed(2) +
                ' (' +
                status.completed +
                ' of ' +
                status.total +
                ')';
            }
            $('#status').text(text);
          },
        )
        .then(gp => {
          geoPackage = gp;
          clearInfo();
          readGeoPackage(gp);
          $('#choose-label')
            .find('i')
            .toggle();
          $('#download').removeClass('gone');
          $('#status').addClass('gone');
        })
        .catch(e => {
          console.error(e);
        });
    }
    // if it is a CSV file
    else if (f.name.lastIndexOf('csv') > f.name.lastIndexOf('.')) {
      if (window.Piwik) {
        Piwik.getAsyncTracker().trackEvent('CSV', 'load', 'File Size', array.byteLength);
      }
      ga('send', {
        hitType: 'event',
        eventCategory: 'CSV',
        eventAction: 'load',
        eventLabel: 'File Size',
        eventValue: array.byteLength,
      });
      new CSVToGeoPackage().convert(
        {
          csvData: array,
        },
        function(status) {
          let text = status.status;
          if (status.completed) {
            text +=
              ' - ' +
              ((status.completed / status.total) * 100).toFixed(2) +
              ' (' +
              status.completed +
              ' of ' +
              status.total +
              ')';
          }
          $('#status').text(text);
        },
        function(err, gp) {
          geoPackage = gp;
          clearInfo();
          readGeoPackage(gp);
          $('#choose-label')
            .find('i')
            .toggle();
          $('#download').removeClass('gone');
          $('#status').addClass('gone');
        },
      );
    }
    // if it is a PBF file
    else if (f.name.lastIndexOf('pbf') > f.name.lastIndexOf('.')) {
      if (window.Piwik) {
        Piwik.getAsyncTracker().trackEvent('PBF', 'load', 'File Size', array.byteLength);
      }
      ga('send', {
        hitType: 'event',
        eventCategory: 'PBF',
        eventAction: 'load',
        eventLabel: 'File Size',
        eventValue: array.byteLength,
      });
      PBFToGeoPackage.convert(
        {
          pbf: array,
        },
        function(status) {
          let text = status.status;
          if (status.completed) {
            text +=
              ' - ' +
              ((status.completed / status.total) * 100).toFixed(2) +
              ' (' +
              status.completed +
              ' of ' +
              status.total +
              ')';
          }
          $('#status').text(text);
        },
        function(err, gp) {
          geoPackage = gp;
          clearInfo();
          readGeoPackage();
          $('#choose-label')
            .find('i')
            .toggle();
          $('#download').removeClass('gone');
          $('#status').addClass('gone');
        },
      );
    }
    // if file is KML or KMZ file
    else if (
      f.name.lastIndexOf('kml') > f.name.lastIndexOf('.') ||
      f.name.lastIndexOf('kmz') > f.name.lastIndexOf('.')
    ) {
      if (window.Piwik) {
        Piwik.getAsyncTracker().trackEvent('GeoPackage', 'load', 'File Size', array.byteLength);
      }
      ga('send', {
        hitType: 'event',
        eventCategory: 'GeoPackage',
        eventAction: 'load',
        eventLabel: 'File Size',
        eventValue: array.byteLength,
      });
      const convert = new KMLToGeoPackage();

      convert
        .convert({
          kmlOrKmzPath: path.basename(f.name),
          kmlOrKmzData: array,
          isKMZ: f.name.lastIndexOf('kmz') > f.name.lastIndexOf('.'),
          tableName: path.basename(f.name, path.extname(f.name)) || 'features',
          indexTable: true,
          // geoPackage: path.basename(f.name, path.extname(f.name)) + '.gpkg',
        })
        .then(function(gp) {
          geoPackage = gp;
          clearInfo();
          readGeoPackage(gp);
          $('#choose-label')
            .find('i')
            .toggle();
          $('#download').removeClass('gone');
          $('#status').addClass('gone');
        });
    }
  };
  r.readAsArrayBuffer(f);
};

window.zoomTo = function(minX, minY, maxX, maxY, projection) {
  try {
    const sw = proj4(projection, 'EPSG:4326', [minX, minY]);
    const ne = proj4(projection, 'EPSG:4326', [maxX, maxY]);
    map.fitBounds([
      [sw[1], sw[0]],
      [ne[1], ne[0]],
    ]);
  } catch (e) {
    map.fitBounds([
      [minY, minX],
      [maxY, maxX],
    ]);
  }
};

window.toggleLayer = function(layerType, table) {
  if (tableLayers[table]) {
    map.removeLayer(tableLayers[table]);
    delete tableLayers[table];
    delete featureLayers[table];
    return;
  }

  if (layerType === 'tile') {
    if (window.Piwik) {
      Piwik.getAsyncTracker().trackEvent('Layer', 'load', 'Tile Layer');
    }
    ga('send', {
      hitType: 'event',
      eventCategory: 'Layer',
      eventAction: 'load',
      eventLabel: 'Tile Layer',
    });
    const tileDao = geoPackage.getTileDao(table);
    // these are not the correct zooms for the map.  Need to convert the GP zooms to leaflet zooms
    const maxZoom = tileDao.maxWebMapZoom;
    const minZoom = tileDao.minWebMapZoom;
    const tableLayer = new L.GridLayer({ noWrap: true, pane: 'tilePane' });
    tableLayer.createTile = function(tilePoint) {
      const canvas = L.DomUtil.create('canvas');
      const size = this.getTileSize();
      canvas.width = size.x;
      canvas.height = size.y;

      const div = L.DomUtil.create('div', 'leaflet-tile');
      const progressDiv = L.DomUtil.create('div', 'progress-grid-positioner');
      progressDiv.innerHTML =
        '<div class="lds-grid"><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div></div>';
      div.appendChild(canvas);

      div.appendChild(progressDiv);

      setTimeout(function() {
        console.time('Draw tile ' + tilePoint.x + ', ' + tilePoint.y + ' zoom: ' + tilePoint.z);
        geoPackage
          .xyzTileScaled(table, tilePoint.x, tilePoint.y, tilePoint.z, size.x, size.y, canvas, 5, 5)
          .then(function() {
            console.timeEnd('Draw tile ' + tilePoint.x + ', ' + tilePoint.y + ' zoom: ' + tilePoint.z);
            div.removeChild(progressDiv);
            // done(null, canvas);
          });
      }, 0);
      return div;
    };
    map.addLayer(tableLayer);
    tableLayer.bringToFront();
    tableLayers[table] = tableLayer;
  } else if (layerType === 'feature') {
    if (window.Piwik) {
      Piwik.getAsyncTracker().trackEvent('Layer', 'load', 'Feature Layer');
    }
    ga('send', {
      hitType: 'event',
      eventCategory: 'Layer',
      eventAction: 'load',
      eventLabel: 'Feature Layer',
    });

    const tableInfo = tableInfos[table];

    geoPackage
      .indexFeatureTable(table, function(message) {
        $('#status-' + table)
          .find('span')
          .html(message);
      })
      .then(function() {
        const tableLayer = new L.GridLayer({ noWrap: true, pane: 'overlayPane' });
        const featureDao = geoPackage.getFeatureDao(table);
        const ft = new window.GeoPackage.FeatureTiles(featureDao, 256, 256);
        ft.maxFeaturesPerTile = 10000;
        ft.maxFeaturesTileDraw = new window.GeoPackage.NumberFeaturesTile();

        tableLayer.createTile = function(tilePoint, done) {
          const canvas = L.DomUtil.create('canvas', 'leaflet-tile');
          canvas.width = 256;
          canvas.height = 256;
          if (!featureDao) return;
          ft.drawTile(tilePoint.x, tilePoint.y, tilePoint.z, canvas).then(() => {
            done(null, canvas);
          });

          return canvas;
        };
        map.addLayer(tableLayer);
        tableLayers[table] = tableLayer;
        featureLayers[table] = tableLayer;
      });
  }
};

function addRowToLayer(iterator, row, featureDao, srs, layer) {
  return new Promise(function(resolve, reject) {
    setTimeout(function() {
      const currentRow = featureDao.getFeatureRow(row);
      const json = GeoPackage.parseFeatureRowIntoGeoJSON(currentRow, srs);
      layer.addData(json);
      resolve(json);
    });
  }).then(function() {
    const nextRow = iterator.next();
    if (!nextRow.done) {
      return addRowToLayer(iterator, nextRow.value, featureDao, srs, layer);
    }
  });
}

function pointStyle(feature) {
  let radius = 2;
  let size = 26;
  if (feature.properties['marker-size']) {
    switch (feature.properties['marker-size']) {
      case 'small':
        radius = 2;
        size = 26;
        break;
      case 'medium':
        radius = 4;
        size = 32;
        break;
      case 'large':
        radius = 6;
        size = 38;
        break;
    }
  }
  return {
    icon:
      feature.properties['marker-symbol'] && feature.properties['marker-symbol'] !== ''
        ? feature.properties['marker-symbol']
        : feature.properties['type'],
    background: feature.properties['marker-color'] || '#00F',
    weight: feature.properties['stroke-width'] ? Number(feature.properties['stroke-width']) : 2,
    opacity: feature.properties['stroke-opacity'] ? Number(feature.properties['stroke-opacity']) : 1,
    size: size,
    radius: radius,
  };
}

function pointToLayer(feature, latlng) {
  // just key off of marker-symbol, otherwise create a circle marker
  if (feature.properties.hasOwnProperty('marker-symbol')) {
    return L.marker(latlng, {
      icon: L.icon.mapkey(pointStyle(feature)),
    });
  }
  return L.circleMarker(latlng, pointStyle(feature));
}

function featureStyle(feature) {
  return {
    weight: feature.properties['stroke-width'] ? Number(feature.properties['stroke-width']) : 2,
    opacity: feature.properties['stroke-opacity'] ? Number(feature.properties['stroke-opacity']) : 1,
    fillColor: feature.properties['fill'] || '#00F',
    fillOpacity: feature.properties['fill-opacity'] ? Number(feature.properties['fill-opacity']) : 0.2,
    color: feature.properties['stroke'] || '#00F',
  };
}

function loadRequestedLayers() {
  const urlString = window.location.href;
  const url = new URL(urlString);
  const layersToLoad = [
    'knotenpunkte_muensterland',
    'knotenpunktnetz_muensterland'
  ]
  if (layersToLoad) {
    for (let i = 0; i < layersToLoad.length; i++) {
      if (window.Piwik) {
        Piwik.getAsyncTracker().trackEvent('Layer Provided In URL', 'load');
      }
      $('input[name="onoffswitch-' + layersToLoad[i] + '"]').trigger('click');
    }
  }
  const layerToZoomTo = "knotenpunkte_muensterland";
  if (layerToZoomTo) {
    $('#zoom-' + layerToZoomTo).trigger('click');
  }
}

window.loadUrl = function(url, loadingElement, gpName, type) {

  fileName = url.split('/').pop();
  loadingElement.toggle();

  const xhr = new XMLHttpRequest();
  xhr.open('GET', url, true);
  xhr.responseType = 'arraybuffer';

  $('#choose-label')
    .find('span')
    .text(gpName);
  $('#choose-label')
    .find('i')
    .toggle();
  xhr.onload = function(e) {
    const uInt8Array = new Uint8Array(this.response);
    switch (type) {
      case 'data':
        // this case we have to try to determine what kind of thing it is
        break;
      case 'geojson':
        handleGeoJSONByteArray(uInt8Array, function() {
          $('#download').removeClass('gone');
          $('#choose-label')
            .find('i')
            .toggle();
          loadingElement.toggle();
          loadRequestedLayers();
        });
        break;
      case 'mbtiles':
        break;
      case 'xyz':
        handleXYZZipByteArray(uInt8Array, function(err) {
          if (!err) {
            $('#download').removeClass('gone');
            $('#choose-label')
              .find('i')
              .toggle();
            loadingElement.toggle();
            return loadRequestedLayers();
          }
          // could be a regular shapefile
        });
        break;
      case 'shapefile':
      case 'shapefilezip':
        handleShapefileZipByteArray(uInt8Array, function(err) {
          if (!err) {
            $('#download').removeClass('gone');
            $('#choose-label')
              .find('i')
              .toggle();
            loadingElement.toggle();
            return loadRequestedLayers();
          }
          // could be a regular shapefile
        });
        break;
      case 'gpkg':
      case 'kml':
      case 'kmz':
      default:
        loadByteArray(uInt8Array).then(function() {
          $('#download').removeClass('gone');
          $('#choose-label')
            .find('i')
            .toggle();
          loadingElement.toggle();
          loadRequestedLayers();
        });
        break;
    }
  };
  xhr.send();
};

function determineUrlAndType() {
  const urlString = window.location.href;
  const url = new URL(urlString);
  const types = ['data', 'gpkg', 'shapefile', 'shapefilezip', 'mbtiles', 'geojson', 'kml', 'kmz', 'zip'];

  for (let i = 0; i < types.length; i++) {
    const type = types[i];
    const urlToLoad = url.searchParams.get(types[i]);
    if (urlToLoad) {
      return ;
    }
  }
}

console.log("Moin1")
setTimeout(function() {
  startup();
}, 3000);

function startup() {
  console.log("Moin2")
  const urlToLoad = {
    url: 'münsterland_radnetz.gpkg',
    type: 'gpkg',
  }

  if (urlToLoad) {
    $('#loadFromUrl').toggle();
    $('#loadFromUrl')
      .find('span')
      .html(urlToLoad);
    window.loadUrl(urlToLoad.url, $('#loadFromUrl').find('i'), urlToLoad.url, urlToLoad.type);
  }
};

window.loadZooms = function(tableName, tilesElement) {
  const zoomsTemplate = $('#tile-zoom-levels-template').html();
  Mustache.parse(zoomsTemplate);

  const tileDao = geoPackage.getTileDao(tableName);
  const zooms = [];
  for (let i = tileDao.minZoom; i <= tileDao.maxZoom; i++) {
    zooms.push({ zoom: i, tableName: tableName });
  }
  const zoomLevels = {
    zooms: zooms,
  };
  const rendered = Mustache.render(zoomsTemplate, zoomLevels);
  tilesElement.empty();
  tilesElement.append(rendered);
};

const visibleTileTables = {};

window.zoomMap = function(zoom) {
  map.setZoom(zoom);
};

window.registerTileTable = function(tableName, tilesElement) {
  visibleTileTables[tableName] = tilesElement;
  loadTiles(tableName, map.getZoom(), tilesElement);
};

window.unregisterTileTable = function(tableName) {
  delete visibleTileTables[tableName];
};

map.on('moveend', function() {
  for (const table in visibleTileTables) {
    window.loadTiles(table, map.getZoom(), visibleTileTables[table]);
  }
});

window.loadTiles = function(tableName, zoom, tilesElement) {
  const mapBounds = map.getBounds();
  if (imageOverlay) map.removeLayer(imageOverlay);
  currentTile = {};

  const tilesTableTemplate = $('#all-tiles-template').html();
  Mustache.parse(tilesTableTemplate);

  const tiles = geoPackage.getTilesInBoundingBoxWebZoom(
    tableName,
    zoom,
    Math.max(-180, mapBounds.getWest()),
    Math.min(mapBounds.getEast(), 180),
    mapBounds.getSouth(),
    mapBounds.getNorth(),
  );
  if (!tiles || !tiles.tiles || !tiles.tiles.length) {
    tilesElement.empty();
    tilesElement.html(
      '<div class="section-title">No tiles exist in the GeoPackage for the current bounds and zoom level</div>',
    );
    return;
  }
  const rendered = Mustache.render(tilesTableTemplate, tiles);
  tilesElement.empty();
  tilesElement.append(rendered);
};

window.zoomToTile = function(
  tileColumn,
  tileRow,
  zoom,
  minLongitude,
  minLatitude,
  maxLongitude,
  maxLatitude,
  projection,
  tableName,
) {
  if (imageOverlay) map.removeLayer(imageOverlay);
  if (
    tileColumn === currentTile.tileColumn &&
    tileRow === currentTile.tileRow &&
    zoom === currentTile.zoom &&
    tableName === currentTile.tableName
  ) {
    currentTile = {};
    return;
  }
  const sw = proj4(projection, 'EPSG:4326', [minLongitude, minLatitude]);
  const ne = proj4(projection, 'EPSG:4326', [maxLongitude, maxLatitude]);

  const tile = geoPackage.getTileFromTable(tableName, zoom, tileRow, tileColumn);
  const tileData = tile.tileData;
  const type = fileType(tileData);
  let binary = '';
  const bytes = tileData;
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64Data = btoa(binary);
  const url = 'data:' + type.mime + ';base64,' + base64Data;
  imageOverlay = L.imageOverlay(url, [
    [sw[1], sw[0]],
    [ne[1], ne[0]],
  ]);
  currentTile.tileColumn = tileColumn;
  currentTile.tileRow = tileRow;
  currentTile.zoom = zoom;
  currentTile.tableName = tableName;
  imageOverlay.addTo(map);
};
const highlightLayer = L.geoJson([], {
  style: function(feature) {
    return {
      color: '#FF0000',
      weight: 3,
      opacity: 1,
    };
  },

  onEachFeature: function(feature, layer) {
    let string = '';
    for (const key in feature.properties) {
      const columnMap = tableInfos[feature.properties.tableName].columnMap;
      string = '';
      if (feature.properties.name || feature.properties.description) {
        string += feature.properties.name
          ? '<div class="item"><span class="label">' + feature.properties.name
          : '</span></div>';
        string += feature.properties.description ? feature.properties.description : '';
      } else {
        for (const key in feature.properties) {
          if (columnMap && columnMap[key] && columnMap[key].displayName) {
            string += '<div class="item"><span class="label">' + columnMap[key].displayName + ': </span>';
          } else {
            string += '<div class="item"><span class="label">' + key + ': </span>';
          }
          string += '<span class="value">' + feature.properties[key] + '</span></div>';
        }
      }
    }
    layer.bindPopup(string);
  },
  coordsToLatLng: function(coords) {
    if (_.isFinite(coords[0]) && _.isFinite(coords[1])) {
      return L.GeoJSON.coordsToLatLng(coords);
    }
    return L.GeoJSON.coordsToLatLng([0, 0]);
  },
});

window.highlightTile = function(minLongitude, minLatitude, maxLongitude, maxLatitude, projection) {
  if (minLongitude && minLatitude && maxLatitude && maxLongitude) {
    const sw = proj4(projection, 'EPSG:4326', [minLongitude, minLatitude]);
    const ne = proj4(projection, 'EPSG:4326', [maxLongitude, maxLatitude]);
    const poly = {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [sw[0], sw[1]],
            [sw[0], ne[1]],
            [ne[0], ne[1]],
            [ne[0], sw[1]],
            [sw[0], sw[1]],
          ],
        ],
      },
    };

    highlightLayer.clearLayers();
    highlightLayer.addData(poly);
    highlightLayer.bringToFront();
  }
};

window.loadFeatures = function(tableName, featuresElement) {
  // tableName = tableName.replace(/\s/, '_');
  const featuresTableTemplate = $('#all-features-template').html();
  Mustache.parse(featuresTableTemplate);

  const featureTemplate = $('#feature-template').html();
  Mustache.parse(featureTemplate);

  featuresElement.empty();

  const features = {
    columns: tableInfos[tableName].columns,
    srs: tableInfos[tableName].srs,
    geometryColumns: tableInfos[tableName].geometryColumns,
    tableName: tableName.replace(/\s/g, '_'),
    features: [],
  };
  const sanitizedColumns = [];
  for (let i = 0; i < features.columns.length; i++) {
    if (
      features.columns[i].name.toLowerCase() != '_properties_id' &&
      features.columns[i].name.toLowerCase() != '_feature_id'
    ) {
      sanitizedColumns.push(features.columns[i]);
    }
  }
  features.columns = sanitizedColumns;
  featuresElement.append(Mustache.render(featuresTableTemplate, features));

  const featuresTable = featuresElement.find('#' + tableName.replace(/\s/g, '_') + '-feature-table');

  const each = geoPackage.iterateGeoJSONFeatures(tableName);
  const promise = Promise.resolve();
  for (const row of each) {
    const feature = row;
    feature.tableName = tableName; //tableName.replace(/\s/g, '_');
    feature.values = [];

    for (let i = 0; i < features.columns.length; i++) {
      let value = feature.properties[features.columns[i].name];

      if (features.columns[i].displayName) {
        value = feature.properties[features.columns[i].displayName];
      }

      if (features.columns[i].name == features.geometryColumns.geometryColumn) {
        if (feature.geometry) {
          feature.values.push(feature.geometry.type);
        } else {
          feature.values.push('Unknown');
        }
      } else if (features.columns[i].name === 'id') {
        feature.values.push(feature.id);
      } else if (value === null || value === 'null' || value == undefined) {
        feature.values.push('');
      } else {
        feature.values.push(value.toString());
      }
    }
    console.log(feature);
    // console.log(featureTemplate)

    featuresTable.append(Mustache.render(featureTemplate, feature));
    console.log(featuresTable);
  }
  return features;
};

map.addLayer(highlightLayer);

window.highlightFeature = function(featureId, tableName) {
  // tableName = tableName.replace('_', ' ');
  const geoJson = geoPackage.getFeature(tableName, featureId);
  geoJson.properties.tableName = tableName;
  highlightLayer.clearLayers();
  highlightLayer.addData(geoJson);
  highlightLayer.bringToFront();
};

window.zoomToFeature = function(featureId, tableName) {
  window.toggleFeature(featureId, tableName, true, true);
};

let currentFeature;
const featureLayer = L.geoJson([], {
  style: function(feature) {
    return {
      color: '#8000FF',
      weight: 3,
      opacity: 1,
    };
  },
  onEachFeature: function(feature, layer) {
    let string = '';
    for (const key in feature.properties) {
      const columnMap = tableInfos[feature.properties.tableName].columnMap;
      string = '';
      if (feature.properties.name || feature.properties.description) {
        string += feature.properties.name
          ? '<div class="item"><span class="label">' + feature.properties.name
          : '</span></div>';
        string += feature.properties.description ? feature.properties.description : '';
      } else {
        for (const key in feature.properties) {
          if (key == 'tableName') continue;
          if (columnMap && columnMap[key] && columnMap[key].displayName) {
            string += '<div class="item"><span class="label">' + columnMap[key].displayName + ': </span>';
          } else {
            string += '<div class="item"><span class="label">' + key + ': </span>';
          }
          string += '<span class="value">' + feature.properties[key] + '</span></div>';
        }
      }
    }
    layer.bindPopup(string);
  },
  coordsToLatLng: function(coords) {
    // if (coords[0] < 0) {
    //   coords[0] = coords[0] + 360;
    // }
    return L.GeoJSON.coordsToLatLng(coords);
  },
});
map.addLayer(featureLayer);

window.toggleFeature = function(featureId, tableName, zoom, force) {
  featureLayer.clearLayers();

  if (currentFeature === featureId && !force) {
    currentFeature = undefined;
    return;
  }

  currentFeature = featureId;

  const geoJson = geoPackage.getFeature(tableName, featureId);
  geoJson.properties.tableName = tableName;
  featureLayer.addData(geoJson);
  featureLayer.bringToFront();
  if (zoom) {
    map.fitBounds(featureLayer.getBounds());
  }
};

window.clearHighlights = function() {
  highlightLayer.clearLayers();
};
