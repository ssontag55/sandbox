function startupMap(){
    me = this;

    this.datalist = [];
    me.resultLyr = [];
    me.resultInterpolateLyr = [];
    me.resultHeatmapLyr = [];

    me.valuebreak1 = 1;
    me.valuebreak2 = 100;
    me.valuebreak3 = 1000;
    me.valuebreak4 = 10000;

    me.layerFields = [
         {
           name: "RecordId",
           alias: "RecordId",
           type: "oid"
         }, {
           name: "String_4",
           alias: "Date",
           type: "string"
         }, {
           name: "String_17",
           alias: "Result",
           type: "string"
         }, {
           name: "depth",
           alias: "Depth",
           type: "string"
         }, {
           name: "String_11",
           alias: "Chemical",
           type: "string"
         }, {
           name: "String_19",
           alias: "Units",
           type: "string"
         }
    ];

    me.map = L.map('viewDiv').setView([30.458,-91.1811], 15);
    me.layer = L.esri.basemapLayer('Topographic').addTo(map);

    map.on('load', function () {
        mapLoaded = true;
    });
    map.zoomControl.setPosition('bottomleft');

    getQueryList();

    $("#queryNameDropdown").on('change', me.updateChemicalList);
    $("#chemNameDropdown").on('change', me.refreshData);
    $("#genheat").click(me.updateHeatMap);
    $("#interpLayerToggle").click(me.toggleInterpolateLayer);
    $("#refreshDataID").on('click', me.showContourLines);

    //$("#chemDateDropdown").on('change', me.refreshData);
  }

  function getQueryList(){

    var reqUrl = "https://dev.terrabase.com/api/Tenant/1190/Report?sort=&page=1&pageSize=1000&group=&filter=Token~eq~'analytical_results'~and~IsGeoreferenced~eq~'Yes'";
    //var reqUrl = "list.json";

    $.ajax({
          type: "GET",
          async: true,
          url: reqUrl,
          contentType: "application/json; charset=utf-8",
          dataType: "json"
      })
      .fail(function (error) {
          console.log(error);
          alert("Service Error For Requested Chemicals");
      })
      .done(function (data) {
        $("#queryNameDropdown").empty();
        if(data.Data.length>0){

          for (var group in data.Data){ 
               
               $("#queryNameDropdown").append($('<option></option>').val(data.Data[group].ReportId).html(data.Data[group].Name));
            }
          }

          updateChemicalList(1106);
    });
  }

  function refreshData(){
    
    $("#refreshDataID").attr('value', "Loading...");  
    $("#loadinggf").show();
    
    var maxResultValue = 1;
    var minResultValue = 1;

    me.map.removeLayer(me.resultLyr);
    me.map.removeLayer(me.resultInterpolateLyr);
    me.map.removeLayer(me.resultHeatmapLyr);
    $('#genheat').prop( "checked", false );

    var chemID = document.getElementById('chemNameDropdown').value;

    me.resultLyr = {
      type: "FeatureCollection",
      id: 1,
      features: []
    };

    var datalist2Map = [];

    if(me.datalist.length>0){

      try{
          for (var group in me.datalist){ 
            if( me.datalist[group].String_11 == chemID){

                /*3D points
                if(me.datalist[group].String_2 != null && me.datalist[group].String_3 != null){
                  var depthavg = Number(me.datalist[group].String_2)+Number(me.datalist[group].String_3)/2;
                  var px = me.datalist[group].String_10;
                  var py = me.datalist[group].String_9;
                  me.datalist[group].depth = depthavg;
                  var is3Dlayer = true;
                }*/

               if(Number(me.datalist[group].String_17) > maxResultValue){
                  maxResultValue = Number(me.datalist[group].String_17);
                }
                if(Number(me.datalist[group].String_17) < minResultValue){
                  minResultValue = Number(me.datalist[group].String_17);
                }               

                var obj = {};

                obj.properties = me.datalist[group];
                obj.type = "Feature";
                obj.geometry = {
                    coordinates: [
                    me.datalist[group].String_10,
                    me.datalist[group].String_9
                    ],
                    type: "Point"
                };
                me.resultLyr.features.push(obj);
            }   
        }

        me.resultLyr = L.geoJson(me.resultLyr, {
          
          onEachFeature:function(feature, layer){
            layer.bindPopup("<b>"+feature.properties.String_1+"</b><br><br>Value:  "+feature.properties.String_17+"  "+feature.properties.String_19+"<br>Chemical:  "+feature.properties.String_11+"<br>Date: "+feature.properties.String_4+"<br>",feature.properties.String_1);
          },
          pointToLayer: function (feature, latlng) {

              var geojsonMarkerOptions = {
                  radius: 7,
                  fillColor: "#ff7800",
                  color: "#000",
                  weight: 1,
                  opacity: .6,
                  fillOpacity: 0.6
              };
              return L.circleMarker(latlng, geojsonMarkerOptions);
          }
        });
        map.fitBounds(me.resultLyr);

        me.valuebreak1 = minResultValue;
        me.valuebreak2 = maxResultValue*.5;
        me.valuebreak3 = maxResultValue*.75;
        me.valuebreak4 = maxResultValue*1;

        me.map.addLayer(me.resultLyr);           
      }
      catch (e){
        alert("There is no valid data in this query.<br>"+e);
      }
    }
    else{
      alert("There is no valid data in this query.");
    }
           
    $("#refreshDataID").html("Interpolate Points");  
    $("#loadinggf").hide();
  }

  function updateChemicalList(queryID){

      var queryID = document.getElementById('queryNameDropdown').value;
      me.datalist = [];
      
      //var reqUrl = "1106.json";
      var reqUrl = "https://dev.terrabase.com/api/Tenant/1190/Report/"+queryID+"?sort=&page=1&pageSize=200&group=&filter=";

      $.ajax({
          type: "GET",
          async: true,
          url: reqUrl,
          contentType: "application/json; charset=utf-8",
          dataType: "json"
      })
      .fail(function (error) {
          console.log(error);
          alert("Service Error For Requested Chemicals");
      })
      .done(function (data) {

        if(data.Data.length>0){

          var chemList = [];
          $("#chemNameDropdown").empty();

          for (var group in data.Data){ 

             //only grab valid geo data
             if(data.Data[group].String_9 != null && data.Data[group].String_10 != null){
                me.datalist.push(data.Data[group]); 

                 if(chemList.indexOf(data.Data[group].String_11) < 0){
                    chemList.push(data.Data[group].String_11);
                    $("#chemNameDropdown").append($('<option></option>').val(data.Data[group].String_11).html(data.Data[group].String_11));
                 }
             }          
          }
        }
        //me.updateChemicalDateList();
        $("#refreshDataID").html("Interpolate Points");  
        $("#loadinggf").hide();
        $('#interpLayerToggle').prop( "checked", false );
        refreshData();
      });
  }

  function toggleInterpolateLayer(e){
      if(me.resultInterpolateLyr.options){
        if($('#interpLayerToggle').prop('checked') == true){
            me.map.addLayer(me.resultInterpolateLyr);
        }
        else{
            me.map.removeLayer(me.resultInterpolateLyr);
        } 
      }
  }

  function updateHeatMap(e){

      if($('#genheat').prop('checked') == true){

          var heatmapArray = [];
          var maxVal = 0;
          for (var val in me.datalist){
              heatmapArray.push([me.datalist[val].String_9,me.datalist[val].String_10,me.datalist[val].String_17]);
              if(me.datalist[val].String_17>maxVal){
                maxVal = me.datalist[val].String_17;
              }
          }

          //gradient - color gradient config, e.g. {0.4: 'blue', 0.65: 'lime', 1: 'red'}
          me.resultHeatmapLyr = L.heatLayer(heatmapArray, {maxZoom: 13,minOpacity:.9,radius: 40,blur:60, max:maxVal/2, gradient:{.1:'#75995A', .5:'#AAC92D', .7:'#E0D819', .9:'#EEBB11', 1:'#FD9B08'}}).addTo(map);

          me.resultLyr.getLayers().map(function(pt) {
              pt.bringToFront();
          });
      }
      else{
          me.map.removeLayer(me.resultHeatmapLyr);
      }
  }

  /* Time option disabled right now
  function updateChemicalDateList(){

    var chemID = document.getElementById('chemNameDropdown').value;

    $("#chemDateDropdown").empty();      
    var dateList = [];

    for (var group in me.datalist){ 
       if(dateList.indexOf(me.datalist[group].String_4) < 0 && me.datalist[group].String_11 == chemID){
          dateList.push(me.datalist[group].String_4);
          $("#chemDateDropdown").append($('<option></option>').val(me.datalist[group].String_4).html(me.datalist[group].String_4));
       }
     }
      
     $("#refreshDataID").html("Interpolate Points");  
     $("#loadinggf").hide();
     refreshData();
  }*/

  function showContourLines() {

      $("#refreshDataID").html("Interpolating Data ..");  
      $("#loadinggf").show();
      $('#interpLayerToggle').prop( "checked", true );

      me.map.removeLayer(me.resultInterpolateLyr);

      //turn points to geojson
      var pts = turf.featurecollection(me.resultLyr.getLayers().map(function (pt) {
          return pt.toGeoJSON()
      }));

      var brew = new classyBrew();
      var values = [];

      var featureSet = [];
      for (var i = 0; i < pts.features.length; i++) {
          if (pts.features[i].properties['String_17'] == null) continue;
          values.push(pts.features[i].properties['String_17']);
          featureSet.push(L.esri.Util.geojsonToArcGIS(pts.features[i]));
      }

      var fieldName = pts.features[0].properties.String_11;
      var unitsName = pts.features[0].properties.String_19;

      brew.setSeries(values);
      // define number of classes
      brew.setNumClasses(9);
      brew.setColorCode("tbcolor");
      brew.classify("equal_interval");
      brew.breaks[0] = 0;
      brew.series[0] = 0;
      brew.range[0] = 0;
      var breaks = brew.getBreaks();

      function styleHeatMap(feature) {
        return {
            weight: 0,
            opacity: 0,
            //color: 'white',
            color: brew.getColorInRange(feature.properties.gridcode),
            //dashArray: '3',
            fillOpacity: 0.9,
            fillColor: brew.getColorInRange(feature.properties.gridcode)
        }
      }
      
      var datarangeMax = Number(brew.range[9]);

      var contourGPURL ="https://map-1.terrabase.com/server/rest/services/gp/json2interpolate/GPServer/geojson2interpolate";
      var gpService = L.esri.GP.Services.geoprocessing(contourGPURL);

      var gpTask = gpService.createTask();
      gpTask.options.path = 'submitJob';
      gpTask.options.async = true;
      var featureCollection = {
          "displayFieldName": "",
          "fieldAliases":{
              "RecordId": "RecordId",
              "String_17": "result",
              "String_1": "title"
          },
          "fields": [{
              "name": "RecordId",
              "alias": "RecordId",
              "type": "esriFieldTypeOID"
          }, {
              "name": "String_17",
              "alias": "Description",
              "type": "esriFieldTypeDouble"
          }, {
              "name": "String_1",
              "alias": "Title",
              "type": "esriFieldTypeString"
          }],
          "geometryType": "esriGeometryPoint",
          "spatialReference": {
              "wkid": 4326,
              "latestWkid": 4326
          },
          "features": featureSet
      };

      gpTask.setParam("inputjson", JSON.stringify(featureCollection));
      gpTask.setParam("field", "String_17");
      
      //this is the setting for the cell size
      //need to play with this a little
      if (datarangeMax > 10000) {
          gpTask.setParam("Long", 100);
      }
      else if (datarangeMax > 1500) {
          gpTask.setParam("Long", 50);
      }
      else if (datarangeMax > 200) {
          gpTask.setParam("Long", datarangeMax/10);
      }
      else {
          gpTask.setParam("Long", 0);
      }

      gpTask.run();
      //kendo.ui.progress(this, true);

      gpService.on('requestsuccess', function (e) {

          if (e.response.jobStatus == "esriJobFailed") {
              //kendo.ui.progress(this, false);
              alert("There was an issue interpolating points.<br>");
          }
          else if (e.response.jobStatus == "esriJobSucceeded") {

              try {
                  me.resultInterpolateLyr = new L.GeoJSON(null, {
                      style: function (feature) {
                          return styleHeatMap(feature);
                      },
                      onEachFeature: function (feature, layer) {
                          layer.bindPopup("<br><b>"+fieldName + " = " + feature.properties.gridcode.toFixed(2) + ' ' + unitsName);
                      }
                  });

                  //create empty geojson object and add it to the map
                  me.map.addLayer(me.resultInterpolateLyr);

                  var geojsonresultURL = contourGPURL + '/jobs/' + e.response.jobId + "/results/outjson?f=pjson";
                  
                  $.getJSON(geojsonresultURL, function getjsonurl(response) {
                      //kendo.ui.progress(this, false);

                      //this is the call back from the jsonp ajax request
                      $.getJSON(response.value.url, function parseJSONP(data) {
                          //we call the function to turn it into geoJSON and write a callback to add it to the geojson object
                          toGeoJSON(data,
                              function (d) {
                                  me.resultInterpolateLyr.addData(d);
                              }
                          );

                          //legendj for contour
                          if (me.contourlegend != undefined) {
                              if (contourlegend._map != null) {
                                  me.map.removeControl(contourlegend);
                              }
                          }
                          me.contourlegend = L.control({ position: 'bottomleft' });
                          me.contourlegend.onAdd = function (map) {
                              var labels = [], from, to;
                              for (var i = 0; i < breaks.length; i++) {
                                  from = breaks[i];
                                  to = breaks[i + 1];
                                  if (to) {
                                      labels.push(
                                          '<i style="background:' + brew.getColorInRange(from) + '"></i> ' +
                                          from.toFixed(1) + unitsName + ' &ndash; ' + to.toFixed(1) + unitsName);
                                  }
                              }
                              var legenddiv = L.DomUtil.create('div', 'infolegend');
                              legenddiv.id = 'interp_legend';
                              legenddiv.innerHTML = "Interpolation Legend  " + document.getElementById('queryNameDropdown').value + "<br>" + fieldName + "<br>" + labels.join('<br>');
                              return legenddiv;
                          }
                          me.contourlegend.addTo(map);

                          me.resultLyr.getLayers().map(function(pt) {
                              pt.bringToFront();
                          });
                          $("#refreshDataID").html("Interpolate Points");  
                          $("#loadinggf").hide();
                      });
                  });
              }
              catch (err) {
                  alert("There was an issue interpolating points.<br>"+err);
                  $("#refreshDataID").html("Interpolate Points"); 
                  $("#loadinggf").hide();
                  //kendo.ui.progress(this, false);
              }
          }
          else { 
          }
      });
}

function setBasemap(basemap) {
  if (me.layer) {
    me.map.removeLayer(me.layer);
  }

  me.layer = L.esri.basemapLayer(basemap);

  me.map.addLayer(me.layer);
}
function changeBasemap(basemaps){
  var basemap = basemaps.value;
  setBasemap(basemap);
}

function toGeoJSON(t, e) {
      function r(t) {
          return {
              type: "Point",
              coordinates: [t.x, t.y]
          }
      }

      function o(t) {
          return 1 === t.points.length ? {
              type: "Point",
              coordinates: t.points[0]
          } : {
              type: "MultiPoint",
              coordinates: t.points
          }
      }

      function n(t) {
          return 1 === t.paths.length ? {
              type: "LineString",
              coordinates: t.paths[0]
          } : {
              type: "MultiLineString",
              coordinates: t.paths
          }
      }

      function i(t) {
          if (1 === t.rings.length) return {
              type: "Polygon",
              coordinates: t.rings
          };
          var e = s(t.rings),
              r = e[0],
              o = e[1],
              n = [];
          if (0 === o.length) {
              for (var i = r.length, u = 0; i > u;) n.push([r[u]]);
              return {
                  type: "MultiPolygon",
                  coordinates: n
              }
          }
          return 1 === r.length ? (o.unshift(r[0]), {
              type: "Polygon",
              coordinates: o
          }) : {
              type: "MultiPolygon",
              coordinates: r,
              holes: o
          }
      }

      function s(t) {
          for (var e = [], r = [], o = t.length, n = 0; o > n;) u(t[n]) ? e.push(t[n]) : r.push(t[n]), n++;
          return [e, r]
      }

      function u(t) {
          for (var e = t.length - 1, r = 0, o = 0; e > r;) o += t[r][0] * t[r + 1][1] - t[r + 1][0] * t[r][1], r++;
          return 0 >= o
      }
      for (var g = {
          type: "FeatureCollection",
          features: []
      }, y = t.features.length, a = 0; y > a;) {
          var p = t.features[a],
              l = {
                  type: "Feature",
                  properties: p.attributes
              };
          p.geometry.x ? l.geometry = r(p.geometry) : p.geometry.points ? l.geometry = o(p.geometry) : p.geometry.paths ? l.geometry = n(p.geometry) : p.geometry.rings && (l.geometry = i(p.geometry)), g.features.push(l), a++
      }
      return e ? void e(g) : g
}