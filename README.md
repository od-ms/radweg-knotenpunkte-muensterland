# Radwegenetz Münster

Die Dateien können hier heruntergeladen werden: 

* Knotenpunkte & Knotenpunktenetz als Geopackage: https://od-ms.github.io/radweg-knotenpunkte-muensterland/münsterland_radnetz.gpkg
* Knotenpunkte als Geojson: https://od-ms.github.io/radweg-knotenpunkte-muensterland/knotenpunkte_muensterland.geojson
* Knotenpunktenetz als Geojson: https://od-ms.github.io/radweg-knotenpunkte-muensterland/knotenpunktnetz_muensterland.geojson

Eine Vorschau der Fahrradweg-Knotenpunkte und des verbindenden Knotenpunktnetzes gibt es hier: 
https://od-ms.github.io/radweg-knotenpunkte-muensterland/


Die Dateien werden monatlich aktualisiert per Github Action Schedule.


Quelle für das Radweg-Knotenpunktenetz NRW: https://www.radverkehrsnetz.nrw.de/rvn_link.asp

Lizenz der Daten: 
*Zitat (Stand 13.06.25): "Im Rahmen der 'Open Data - Initiative' des Landes NRW stellt das Ministerium für Umwelt, Naturschutz und Verkehr Daten aus dem Radroutenplaner NRW (für das Gebiet NRW) zur freien Nutzung bereit. Das Angebot ist lizensiert unter der Datenlizenz Deutschland – Zero – Version 2.0."*


# Münsterland aus den NRW Daten extrahieren

## Rechner vorbereiten

Tool `ogr2ogr` installieren:

```bash
sudo apt install gdal-bin
```

## Radwegenetz und Knotenpunkte Münsterland ausschneiden

```bash
# -N        only download newer files
# --debug   show headers and stuff
wget -N --debug https://www.radverkehrsnetz.nrw.de/downloads/knotenpunktnetz_nw.gpkg

# Gucken welche Layer da drin sind
ogrinfo knotenpunktnetz_nw.gpkg 

# Münsterland ausschneiden 
ogr2ogr -f GPKG münsterland_radnetz.gpkg \
  -spat 6.6 51.6 8.3 52.3 \
  -nln knotenpunkte_muensterland \
  -s_srs EPSG:4326 -t_srs EPSG:4326 \
  -progress \
  knotenpunktnetz_nw.gpkg knotenpunkte_nw

ogr2ogr -f GPKG münsterland_radnetz.gpkg \
  -spat 6.6 51.6 8.3 52.3 \
  -nln knotenpunktnetz_muensterland \
  -s_srs EPSG:4326 -t_srs EPSG:4326 \
  -update -append \
  -progress \
  knotenpunktnetz_nw.gpkg knotenpunktnetz_nw

# Als geojson speichern

ogr2ogr -f GeoJSON knotenpunkte_muensterland.geojson \
  münsterland_radnetz.gpkg knotenpunkte_muensterland

ogr2ogr -f GeoJSON knotenpunktnetz_muensterland.geojson \
  münsterland_radnetz.gpkg knotenpunktnetz_muensterland

```
