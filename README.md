# leaflet-tiled-geojson

Leaflet layer for displaying tiled GeoJSON data. Handles levels of detail and feature deduplication. Essentially a drop in replacement for an `L.GeoJSON` layer.

See [tiled-geojson](https://github.com/awhitesmith/tiled-geojson) for generating tiled GeoJSON.

## Example

The following example is for tiled GeoJSON located as follows relative to the root of the web directory.

```txt
path/
├─ to/
│  ├─ tiledgeojson/
│  │  ├─ tiledgeojson.json
│  │  ├─ tiles/
│  │  │  ├─ <sha hash>.json
│  │  │  ├─ ...
```

The tiled GeoJSON layer can be added similar to an L.GeoJSON layer. Options accepted are the same as an L.GeoJSON layer.

```js
var map = L.map('map');

var tiledGeoJsonLayer = L.tiledGeoJSON('/path/to/tiledgeojson/', {
    style: {
        color: 'red',
        fillColor: 'black',
        weight: 0.5
    }
}).addTo(map);
```
