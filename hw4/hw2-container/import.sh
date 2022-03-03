#!/bin/bash

MONGOIMPORT=mongoimport
SOURCE=/hw2-container/factbook.json

function import_file {
  echo "  importing >${1}<..."
  mongoimport --host my_mongo -d hw2 -c factbook --file=${1}
}

function import_region {
  for file in ${SOURCE}/$1/*.json
  do
    import_file ${file}
  done
}

sleep 5

import_region africa
import_region antarctica
import_region australia-oceania
import_region central-america-n-caribbean
import_region central-asia
import_region east-n-southeast-asia
import_region europe
import_region middle-east
import_region north-america
import_region oceans
import_region south-america
import_region south-asia
import_region world