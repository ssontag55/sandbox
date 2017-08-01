var EsriLeafletGP = {
    Tasks: {},
    Services: {},
    Controls: {}
};
if ("undefined" != typeof window && window.L && window.L.esri && (window.L.esri.GP = EsriLeafletGP), !Esri) var Esri = window.L.esri;
EsriLeafletGP.Services.Geoprocessing = Esri.Services.Service.extend({
    options: {
        asyncInterval: 1
    },
    createTask: function () {
        return new EsriLeafletGP.Tasks.Geoprocessing(this, this.options)
    }
}), EsriLeafletGP.Services.geoprocessing = function (a) {
    return new EsriLeafletGP.Services.Geoprocessing(a)
}, EsriLeafletGP.Tasks.Geoprocessing = Esri.Tasks.Task.extend({
    includes: L.Mixin.Events,
    params: {},
    resultParams: {},
    initialize: function (a) {
        L.esri.Tasks.Task.prototype.initialize.call(this, a), this.options.path ? this.options.async !== !0 && "submitJob" !== this.options.path && (this.options.async = !1) : (this.options.async = !1, this.options.path = "execute", this._service.metadata(function (a, b) {
            return a ? (this.options.async = !1, void (this.options.path = "execute")) : ("esriExecutionTypeSynchronous" === b.executionType ? (this.options.async = !1, this.options.path = "execute") : (this.options.async = !0, this.options.path = "submitJob"), void this.fire("initialized"))
        }, this))
    },
    setParam: function (a, b) {
        return "boolean" == typeof b ? void (this.params[a] = b) : "object" != typeof b ? void (this.params[a] = b) : void this._setGeometry(a, b)
    },
    setOutputParam: function (a) {
        this.params.outputParam = a
    },
    gpAsyncResultParam: function (a, b) {
        this.resultParams[a] = b
    },
    _setGeometry: function (a, b) {
        var c = {
            geometryType: "",
            features: []
        };
        b instanceof L.LatLngBounds && (c.features.push({
            geometry: L.esri.Util.boundsToExtent(b)
        }), c.geometryType = L.esri.Util.geojsonTypeToArcGIS(b.type)), b.getLatLng && (b = b.getLatLng()), b instanceof L.LatLng && (b = {
            type: "Point",
            coordinates: [b.lng, b.lat]
        }), b instanceof L.GeoJSON && (b = b.getLayers()[0].feature.geometry, c.features.push({
            geometry: L.esri.Util.geojsonToArcGIS(b)
        }), c.geometryType = L.esri.Util.geojsonTypeToArcGIS(b.type)), b.toGeoJSON && (b = b.toGeoJSON()), "Feature" === b.type && (b = b.geometry), "Point" === b.type || "LineString" === b.type || "Polygon" === b.type ? (c.features.push({
            geometry: L.esri.Util.geojsonToArcGIS(b)
        }), c.geometryType = L.esri.Util.geojsonTypeToArcGIS(b.type)) : console && console.warn && console.warn("invalid geometry passed as GP input. Should be an L.LatLng, L.LatLngBounds, L.Marker or GeoJSON Point Line or Polygon object"), this.params[a] = c
    },
    run: function (a, b) {
        return this._done = !1, this.options.async !== !0 ? this._service.request(this.options.path, this.params, function (c, d) {
            a.call(b, c, d && this.processGPOutput(d), d)
        }, this) : void this._service.request(this.options.path, this.params, function (c, d) {
            this._currentJobId = d.jobId, this.checkJob(this._currentJobId, a, b)
        }, this)
    },
    checkJob: function (a, b, c) {
        var d = function () {
            this._service.request("jobs/" + a, {}, function (d, f) {
                "esriJobSucceeded" === f.jobStatus ? (this._done || (this._done = !0, this._service.request("jobs/" + a + "/results/" + this.params.outputParam, this.resultParams, function (a, d) {
                   // b.call(c, a, d && this.processAsyncOutput(d), d)
                }, this)), window.clearInterval(e)) : "esriJobFailed" === f.jobStatus && (b.call(c, "Job Failed", null), window.clearInterval(e))
            }, this)
        }.bind(this),
            e = window.setInterval(d, 1e3 * this._service.options.asyncInterval)
    },
    processGPOutput: function (a) {
        var b, c = {};
        if (this.options.async === !1)
            for (var d = 0; d < a.results.length; d++)
                if (c[a.results[d].paramName], "GPFeatureRecordSetLayer" === a.results[d].dataType) {
                    var e = L.esri.Util.responseToFeatureCollection(a.results[d].value);
                    c[a.results[d].paramName] = e
                } else c[a.results[d].paramName] = a.results[d].value;
        else c.jobId = this._currentJobId, b = a.value;
        if (this.options.async === !0 && "GPRasterDataLayer" === a.dataType) {
            var f = this.options.url,
                g = f.indexOf("GPServer"),
                h = f.slice(0, g) + "MapServer/";
            c.outputMapService = h + "jobs/" + this._currentJobId
        }
        return c
    },
    processAsyncOutput: function (a) {
        var b = {};
        if (b.jobId = this._currentJobId, this.options.async === !0 && "GPRasterDataLayer" === a.dataType) {
            var c = this.options.url,
                d = c.indexOf("GPServer"),
                e = c.slice(0, d) + "MapServer/";
            b.outputMapService = e + "jobs/" + this._currentJobId
        }
        if ("GPFeatureRecordSetLayer" === a.dataType) {
            var f = L.esri.Util.responseToFeatureCollection(a.value);
            b[a.paramName] = f
        } else b[a.paramName] = a.value;
        return b
    }
}), EsriLeafletGP.Tasks.geoprocessing = function (a) {
    return new EsriLeafletGP.Tasks.Geoprocessing(a)
};