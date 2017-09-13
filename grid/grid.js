var bussiness = function() {
    "use strict";

    var OVERLAY_ALPHA = Math.floor(0.3 * 255);
    var MAX_WINDBAR_COUNT=800;


    function getGoogleMap() {
        var tiledmap = L.tileLayer('http://mt2.google.cn/vt/lyrs=t@131,r@216000000&hl=zh-CN&gl=CN&src=app&x={x}&y={y}&z={z}&s=Gal', {
            maxZoom: 16,
            minZoom: 3
        });
        return tiledmap;
    }

    function getOSM(){
        return L.tileLayer('http://{s}.tile.osm.org/{z}/{x}/{y}.png', {
            maxZoom: 16,
            minZoom: 3
        });
    }

    function initMap() {
        var lightMap=getGoogleMap();
        var pinkMap=getOSM();
        var baseLayers={
            "地形":lightMap,
            "OSM":pinkMap

        };
        var map = L.map('mapdiv', {
            layers:[lightMap],
            center: [31, 121],
            zoom: 3
        });
        var layerControl = L.control.layers(baseLayers);
        layerControl.addTo(map);



        return {
            map:map,
            layerControl: layerControl
        };
    }



    function drawScaleColorBar() {
        var colorBar = d3.select("#scale");
        var c = colorBar.node();
        var g = c.getContext("2d");
        var n = c.width - 1;

        var scale = productScale("temp");
        colorScale=scale;
        var bounds = scale.bounds;

        for (var i = 0; i <= n; i++) {
            var rgb = scale.gradient(µ.spread(i / n, bounds[0], bounds[1]), 1);
            g.fillStyle = "rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")";
            g.fillRect(i, 0, 1, c.height);
        }



        // Show tooltip on hover.
        colorBar.on("mousemove", function(event) {
            var x = d3.mouse(this)[0];
            var pct = µ.clamp((Math.round(x) - 2) / (n - 2), 0, 1);
            var value = µ.spread(pct, bounds[0], bounds[1]);
            colorBar.attr("title", parseInt(value));
        });

    }





    function productScale(type) {
        if (type == "temp") {
            return {
                bounds: [1, 41],
                gradient: µ.segmentedColorScale([
                    [1, [37, 4, 42]],
                    [5, [41, 10, 130]],
                    [9, [81, 40, 40]],
                    [13, [192, 37, 149]],
                    [17, [70, 215, 215]],
                    [21, [21, 84, 187]],
                    [25, [24, 132, 14]],
                    [29, [247, 251, 59]],
                    [33, [235, 167, 21]],
                    [37, [230, 71, 39]],
                    [41, [88, 27, 67]]
                ])
            }


        }
    }


    function getGridData() {
        d3.json("data/WIND_GFS20161225120000.json",
            function sucessHandler(data) {
                buildGridMask(data)
            });
    }
    var map;
    var windGrid;
    var uComp;
    var vComp;
    var gridHeader;
    var windLayerGroup;
    var windCanvas;
    var colorScale;

    function buildGridMask(data){

        windCanvas = L.canvasLayer();
        windCanvas.delegate(bussiness).addTo(map);


        windGrid=data;
        gridHeader=windGrid[0].header;
        if(windGrid[0].header.parameterNumberName=="U-component_of_wind"){
            uComp=windGrid[0];
            vComp=windGrid[1];
        }else{
            uComp=windGrid[1];
            vComp=windGrid[0];
        }
        reDrawWindView();
    }




    function reDrawWindView(event){
        var mapExtent = map.getBounds();
        mapExtent=map.wrapLatLngBounds(mapExtent);

        var minLat=mapExtent.getSouth();
        var maxLat=mapExtent.getNorth();
        var minLon=mapExtent.getWest();
        var maxLon=mapExtent.getEast();
        if(maxLon<minLon) {
            maxLon = maxLon + 360;
        }

        var startRowIndex=Math.ceil(Math.abs(maxLat-gridHeader.la1)/gridHeader.dy);
        var endRowIndex =Math.floor(Math.abs(minLat-gridHeader.la1)/gridHeader.dy);
        var startColIndex=Math.ceil(Math.abs(minLon-gridHeader.lo1)/gridHeader.dx);
        var endColIndex=Math.floor(Math.abs(maxLon-gridHeader.lo1)/gridHeader.dx);
        var rowNum=endRowIndex-startRowIndex+1;
        var colNum=endColIndex-startColIndex+1;
        var step=Math.round(rowNum*colNum/MAX_WINDBAR_COUNT);
        if(step<1) {
            step = 1;
        }

        windLayerGroup.clearLayers();

        for(var i=startRowIndex;i<=endRowIndex;i=i+step){
            for(var j=startColIndex;j<=endColIndex;j=j+step){
                var idx=i*gridHeader.nx+j;
                var u=uComp.data[idx];
                var v=vComp.data[idx];

                var lat=gridHeader.la1-i*gridHeader.dy;
                var lon=gridHeader.lo1+j*gridHeader.dx;

                var wd=µ.formatVectorDegree(u,v);
                var ws=µ.formatVectorIntensity(u,v);

                var icon = L.WindBarb.icon({deg: wd, speed:ws,pointRadius:0,strokeColor:'#111',strokeWidth: 1.5});
                var marker = L.marker([lat,lon], {icon: icon}).addTo(map).on('click', windMarkerOnClick);
                marker.addTo(windLayerGroup);


            }
        }

    }

    function onDrawLayer(info) {
        var ctx = info.canvas.getContext('2d');
        var w=info.canvas.width;
        var h=info.canvas.height;
        ctx.clearRect(0, 0,w, h);
        ctx.fillStyle = "rgba(255,255,255, 0)";
        var imgData=ctx.getImageData(0,0,w,h);

        //3个像素插一个值
        var resolution=3;
        for(var i=0;i<w;i=i+resolution){
            for(var j=0;j<h;j=j+resolution)
            {
                var p=L.point(i,j);
                var pt = info.layer._map.containerPointToLatLng(p);
                var wind = interpolatePoint(pt);
                if(wind!=null){

                    var c = colorScale.gradient(wind[2], OVERLAY_ALPHA);

                    //复制给相应的数值
                    for(var ii=0;ii<resolution;ii++)
                    {
                        for(var jj=0;jj<resolution;jj++){

                            var ptx=ii+i;
                            var pty=jj+j;

                            if(ptx>=0&& ptx<w&& pty>=0&pty<h){

                                var ptIdx=ptx+pty*w;

                                var imgIdx=4*ptIdx;
                                imgData.data[imgIdx]=c[0];
                                imgData.data[imgIdx+1]=c[1];
                                imgData.data[imgIdx+2]=c[2];
                                imgData.data[imgIdx+3]=c[3];

                            }


                        }
                    }



                }
            }
        }




        ctx.putImageData(imgData,0,0);




    };


    function interpolatePoint(latlng){
        latlng.wrap();
        if(latlng.lng<0){
            latlng.lng=latlng.lng+360;
        }
        var idx=getPointRowColIndex(latlng);
        //超出数据范围的不需要
        if(idx.row<0 ||idx.row>=gridHeader.ny-1){
            return null;
        }
        if(idx.col<0||idx.col>=gridHeader.nx-1){
            return null
        }

        var g00=getPointValue(idx.row,idx.col);
        var latlng00=getPointLatLng(idx.row,idx.col);

        var g01=getPointValue(idx.row,idx.col+1);
        var g10=getPointValue(idx.row+1,idx.col);
        var g11=getPointValue(idx.row+1,idx.col+1);


        var x=Math.abs(latlng.lng-latlng00.lng)/gridHeader.dx;
        var y=Math.abs(latlng.lat-latlng00.lat)/gridHeader.dy;

        var wind = gisbillinear.bilinearInterpolateVector(x,y,g00,g01,g10,g11);
        return wind;


    }


    function getPointLatLng(i,j){
        var lat=gridHeader.la1-i*gridHeader.dy;
        var lon=gridHeader.lo1+j*gridHeader.dx;
        var latlon = L.latLng(lat, lon);
        latlon.wrap();
        if(latlon.lng<0){
            latlon.lng=latlng.lng+360;
        }
        return latlon;
    }

    function getPointValue(rowIdx,colIdx) {
        var idx=rowIdx*gridHeader.nx+colIdx;
        var u=uComp.data[idx];
        var v=vComp.data[idx];
        return [u,v];
    }


    function getPointRowColIndex(latlng) {
        var rowIndex= parseInt((-latlng.lat+gridHeader.la1)/gridHeader.dy);
        var colIndex= parseInt((latlng.lng-gridHeader.lo1)/gridHeader.dx);
        return {
            row:rowIndex,
            col:colIndex
        }

    }



    function windMarkerOnClick(e) {

    }




    function start() {
        var opt = initMap();
        map=opt.map;
        windLayerGroup=L.layerGroup([]).addTo(map);
        map.on('moveend',reDrawWindView);
        drawScaleColorBar();
        getGridData();

    }


    return{
        start:start,
        onDrawLayer:onDrawLayer
    }


}();