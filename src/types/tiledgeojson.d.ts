import { Feature, GeoJsonProperties, Geometry } from 'geojson';

export type TiledGeoJSONMeta = {
    origin: {
        x: number;
        y: number;
    };
    lods: Array<TiledGeoJSONLodMeta>;
};

export type TiledGeoJSONLodMeta = {
    tileSize: number;
    maxZoom: number;
    tiles: {
        [key: string]: string;
    };
};

export type TiledGeoJSONTileData = {
    features: Feature<Geometry, GeoJsonProperties>[];
};