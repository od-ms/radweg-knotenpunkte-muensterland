#!/bin/bash

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

mv münsterland_radnetz.gpkg dist/ 