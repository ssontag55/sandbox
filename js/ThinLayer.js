define([
   'dojo/_base/declare',
   'dojo/_base/array',
   'dojo/_base/lang',
   'dojo/_base/Color',
   'esri/layers/GraphicsLayer',
   'esri/graphic',
   'esri/geometry/Extent',
   'esri/geometry/Point',
   'esri/symbols/PictureMarkerSymbol',
   "esri/renderers/SimpleRenderer","esri/Color",
   'esri/symbols/TextSymbol'
   ],

   function(declare, array, lang, Color, GraphicsLayer, Graphic, Extent, Point, PictureMarkerSymbol, SimpleRenderer,Color,TextSymbol) {
      
      var thinLayer = declare('ThinLayer', [GraphicsLayer], {

      constructor : function(options) {
         var me = this;

         //basic esri.layers.GraphicsLayer option(s)
         me.displayOnPan = options.displayOnPan || false;

         //set the map
         me._map = options.map;

         me.clusterSize = options.clusterSize || 100;

         me.color = options.color || '#ff0000';
         
         //base connections to update clusters during user/map interaction
         //me._map.on('zoom-start', lang.hitch(me, me._handleMapZoomStart));
         //me._map.on('extent-change', lang.hitch(me, me._handleMapExtentChange));

         //me.on('update', lang.hitch(me, me._handleOnUpdate));

         //holds all the features for this cluster layer
         me._features = [];

         //set incoming features
         try {
            me.setFeatures(options.features);
         } catch (ex) {
            console.log(ex);
         }

         //connects for cluster layer itself that handles the loading and mouse events on the graphics
         //me.on('load', lang.hitch(me, me._handleLayerLoaded));
         //me.on('click', lang.hitch(me, me.handleClick));

         //following the basics of creating a custom layer
         me.loaded = true;
         //me.onLoad(me);
      },

      //clear all graphics when zoom starts
      _handleMapZoomStart : function() {
         this.clear();
      },

      //re-cluster on extent change
      _handleMapExtentChange : function() {
         if (this._map.infoWindow.isShowing)
            this._map.infoWindow.hide();
         this.clear();
         this.clusterFeatures();
      },

      //on update
      _handleOnUpdate : function() {
         if (this._map.infoWindow.isShowing)
            this._map.infoWindow.hide();
      },

      //set features
      setFeatures : function(features) {
         var me = this;
         if (me._map.infoWindow.isShowing)
            me._map.infoWindow.hide();

         me._features = [];
         array.forEach(features, function(feature) {
            me._features.push(feature);
         }, me);
         me.clusterFeatures();
      },

      //set color
      setColor : function(color) {
         this.color = color;
      },

      //fires when cluster layer is loaded, but not added to map yet.
      _handleLayerLoaded : function() {
         //this.clusterFeatures();
      },
      
      // cluster features
      clusterFeatures : function() {
         
         this.clear();
         var features = this._features;
         if (features.length > 0) {

            var clusterSize = this.clusterSize;
            var thinGraphics = [];

            var sr = this._map.spatialReference;
            var orgExt = this._map.extent;
            var mapExt = orgExt;
            var normExts = orgExt.normalize();
            if (normExts.length > 0) {
               mapExt = normExts[0];
               for (var j=1; j<normExts.length; j++) {
                  mapExt = mapExt.union(normExts[j]);
               }
            }
            //var mapExt = this._map.extent;
            var o = new Point(mapExt.xmin, mapExt.ymax, sr);

            var rows = Math.ceil(this._map.height / clusterSize);
            var cols = Math.ceil(this._map.width / clusterSize);
            var distX = mapExt.getWidth() / this._map.width * clusterSize;
            var distY = mapExt.getHeight() / this._map.height * clusterSize;  

            var zoomLevel = Math.abs(this._map.getLevel()-10);
            if(this._map.getLevel()> 7){
               zoomLevel = 0;
            }
                     
            var cGraphics = [];

            for (var c = 0; c < cols; c++) {
               for (var r = 0; r < rows; r++) {
                  var x1 = o.x + (distX * c);
                  var y2 = o.y - (distY * r);
                  var x2 = x1 + distX;
                  var y1 = y2 - distY;

                  var ext = new Extent(x1, y1, x2, y2, sr);

                  var loadedyet = false;
                  for (var i = 0, len = features.length; i < len; i++) {
                     
                     var feature = features[i];
                     if (ext.contains(feature.geometry)) {
                        if(loadedyet == false){
                           cGraphics.push(feature);
                           loadedyet = true;
                        }
                     }
                     //i = i +1;
                  }
                  //c = c +zoomLevel;
                  /*if (cGraphics.length > 0) {
                     var cPt = this._getClusterCenter(cGraphics);
                     thinGraphics.push({
                        center : cPt,
                        graphics : cGraphics
                     });
                  }*/
               }
               //r = r +zoomLevel;
            }

            thinGraphics.push({
               graphics : cGraphics
            });

            /*var zoomLevel = this._map.getZoom();
            var thinGraphics = [];

            var cGraphics = [];
            //Stride tolerance
            if(zoomLevel<8){
               //var indexSkip = features.length/1000;  //this._map.width / (zoomLevel*100);
               var indexColumn = 0;   
               for (var i = 0, len = features.length; i < len; i++) {
                  
                  var feature = features[i];
               
                  if(feature.geometry.y == column){

                     if(indexColumn % 10 == 0){
                        cGraphics.push(feature);   
                     }                     
                     indexColumn++;
                  }
                  else{
                     //cGraphics.push(feature);
                     indexColumn = 0;
                  }

                  var column = feature.geometry.y;
                  
                  //i = parseInt(indexSkip)+i;
               }
               thinGraphics.push({
                  graphics : cGraphics
               });
            }
            else{
               for (var i in features) {
                  var feature = features[i];
                  
                  cGraphics.push(feature);
               }
               thinGraphics.push({
                  graphics : cGraphics
               }); 
            } */                            

            //add cluster to map
            for (var g in thinGraphics[0].graphics) {
               var thinGraphic = thinGraphics[0].graphics[g];
               
               var symbolPic = new PictureMarkerSymbol({
                    url: "iconblue.png",
                    width:50,
                    height:70,
                    angle: thinGraphic.attributes.dir      
                  });

               var iconLabel = new TextSymbol({
                  font: {  // autocast as esri/symbols/Font
                    size: 9,
                    family: "sans-serif"
                    //weight: "bolder"
                  },
                  text: Number(thinGraphic.attributes.mag).toPrecision(2),
                  xoffset: 0,
                  yoffset: -3   
                });
               var txtColor = new Color("#fff");
               iconLabel.setColor(txtColor);

               this.add(new Graphic(thinGraphic.geometry, symbolPic,thinGraphic.attributes));
               this.add(new Graphic(thinGraphic.geometry, iconLabel,thinGraphic.attributes));
            }
         }
      },

      _getClusterCenter : function(graphics) {
         var xSum = 0;
         var ySum = 0;
         var count = graphics.length;
         array.forEach(graphics, function(graphic) {
            xSum += graphic.geometry.x;
            ySum += graphic.geometry.y;
         }, this);
         var cPt = new Point(xSum / count, ySum / count, graphics[0].geometry.spatialReference);
         return cPt;
      }
   });
   
   return thinLayer;
   
}); 