import * as L from 'leaflet';
import { TiledGeoJSONLodMeta, TiledGeoJSONMeta, TiledGeoJSONTileData } from './types/tiledgeojson';
import { Feature, FeatureCollection } from 'geojson';

export interface TiledGeoJSONOptions extends L.GeoJSONOptions {
    /**
     * Whether to make adjustments for retina displays when selecting the best level of detail.
     * Disabled by default.
     */
    detectRetina?: boolean
}

export class TiledGeoJSON extends L.LayerGroup {
    options: TiledGeoJSONOptions;
    meta?: TiledGeoJSONMeta;
    private lods: Array<TiledGeoJSONLod> = [];
    private activeLod?: TiledGeoJSONLod;
    private moveListener?: (event: L.LeafletEvent) => void;

    /**
     * Creates a tiled geojson layer.
     * @param endpoint the path to the location the tiled geojson data is stored.
     * @param options layer options - includes same options as a normal GeoJSON layer.
     */
    constructor(public readonly endpoint: string, options?: TiledGeoJSONOptions) {
        super([], options);
        this.options = options || {};
        this.loadMeta();
    }

    private loadMeta(retryTime = 1) {
        fetch(`${this.endpoint}/tiledgeojson.json`).then(response => response.text().then(text => {
            this.meta = JSON.parse(text) as any;
            this.lods = this.meta!.lods.map(lodMeta => new TiledGeoJSONLod(this, lodMeta, this.options));

            // triger a view update to get us started
            if (this._map) {
                this.updateView(this._map);
            }
        }).catch(err => {
            console.error(`Failed to load tiled geojson meta. Will retry in ${retryTime} seconds.`, err);
            setTimeout(() => this.loadMeta(retryTime * 2), retryTime * 1000);
        }));
    }

    // Handle view changes when the user moves the map.
    // Select the best level of detail and trigger any necessary tile loading / hiding.
    private updateView(map: L.Map) {
        const zoom = map.getZoom() + (this.options.detectRetina && L.Browser.retina ? 1 : 0);
        
        // choose best lod
        var bestLod = undefined;
        for (var lod of this.lods) {
            if (zoom <= lod.meta.maxZoom && (!bestLod || lod.meta.maxZoom < bestLod.meta.maxZoom)) {
                bestLod = lod;
            }
        }
        // default to one with largest max zoom
        if (!bestLod) {
            for (var lod of this.lods) {
                if (!bestLod || lod.meta.maxZoom > bestLod.meta.maxZoom) {
                    bestLod = lod;
                }
            }
        }

        if (this.activeLod != bestLod) {
            // unload active lod
            if (this.activeLod) {
                this.removeLayer(this.activeLod);
                this.activeLod.clearActive();
            }

            this.activeLod = bestLod;
            if (this.activeLod) {
                this.addLayer(this.activeLod);
            }
        }

        this.activeLod?.updateView(map);
    }

    public addTo(map: L.Map | L.LayerGroup): this {
        if ((map as any)["getBounds"]) {
            if (!this.moveListener) {
                this.moveListener = event => {
                    this.updateView(map as L.Map);
                };
            }
            this.updateView(map as L.Map);
            map.addEventListener('moveend', this.moveListener);
        }
        return super.addTo(map);
    }

    public removeFrom(map: L.Map): this {
        if (this.moveListener) {
            map.removeEventListener('moveend', this.moveListener);
        }
        // remove all active tiles
        return super.removeFrom(map);
    }
}

class TiledGeoJSONLod extends L.LayerGroup {
    tiles: Record<string, TiledGeoJSONTile> = {}; // <tile key, tile>
    activeTiles: Record<string, TiledGeoJSONTile> = {}; // <tile key, tile>
    featureHolders: Record<number, Array<string>> = {}; // <feature ID, [tile key]>
    private currentView?: GridView;

    constructor(readonly tiledGeoJson: TiledGeoJSON, readonly meta: TiledGeoJSONLodMeta, options?: L.LayerOptions) {
        super([], options);
    }

    public updateView(map: L.Map) {
        const newView = new GridView(
            this.meta.tileSize!,
            this.tiledGeoJson.meta?.origin.x!,
            this.tiledGeoJson.meta?.origin.y!,
            map.getBounds()
        );

        if (!this.currentView || !this.currentView.sameAs(newView)) {
            // add newly visible tiles
            for (var x = newView.minX; x < newView.minX + newView.stepsX; x++) {
                for (var y = newView.minY; y < newView.minY + newView.stepsY; y++) {
                    const tileKey = `${x},${y}`;
                    const tileHash = this.meta.tiles[tileKey];

                    if (!(tileKey in this.activeTiles) && tileHash) {
                        this.showTile(x, y);
                    }
                }
            }

            // hide now out-of-site tiles
            for (const key of Object.keys(this.activeTiles)) {
                const x = Number(key.split(",")[0]);
                const y = Number(key.split(",")[1]);
                if (x < newView.minX || x >= newView.minX + newView.stepsX ||
                    y < newView.minY || y >= newView.minY + newView.stepsY
                ) {
                    this.hideTile(x, y);
                }
            }

            this.currentView = newView;
        }
    }

    // Hide all active tiles and clear feature holders
    public clearActive() {
        this.currentView = undefined;
        for (const key of Object.keys(this.activeTiles)) {
            const tile = this.activeTiles[key];
            if (tile.fulfilled) {
                this.removeLayer(tile);
                tile.unmaskAll();
            }
        }
        this.featureHolders = {};
        this.activeTiles = {};
    }

    // Show the tile at the given location, loading if necessary, and add feature holders
    private showTile(x: number, y: number) {
        const key = TiledGeoJSONTile.tileKey(x, y);
        if (!(key in this.meta.tiles)) {
            return;
        }

        if (!(key in this.tiles)) {
            this.loadTile(x, y);
        }

        const tile = this.tiles[key];
        if (!tile) {
            return;
        }
        
        if (tile.fulfilled) {
            this.addFeatureHolders(tile);
            this.addLayer(tile);
        }
        this.activeTiles[key] = tile;
    }

    // Hide the tile at the given location and free feature holders.
    private hideTile(x: number, y:number) {
        const key = TiledGeoJSONTile.tileKey(x, y);
        if (!(key in this.activeTiles)) {
            return;
        }

        const tile = this.activeTiles[key];

        if (tile.fulfilled) {
            this.removeLayer(tile);
            this.removeFeatureHolders(tile);
        }
        delete this.activeTiles[key];
    }

    // Add feature holders for the given tile, masking features in the tile that are already being
    // show by another tile to avoid duplication.
    private addFeatureHolders(tile: TiledGeoJSONTile) {
        if (!tile.featureCollection) {
            return;
        }

        tile.featureCollection.features.forEach(feature => {
            const fid = (feature as any).__fid;
            if (fid == undefined) {
                return;
            }
            if (!(fid in this.featureHolders)) {
                this.featureHolders[fid] = [];
            }

            if (this.featureHolders[fid].length > 0) {
                // another tile is showing this feature
                tile.maskFeature(fid);
            }

            this.featureHolders[fid].push(tile.key);
        });
    }

    // Remove feature holders for the given tile, unmasking features in other tiles as necessary
    // to account for duplicate features.
    private removeFeatureHolders(tile: TiledGeoJSONTile) {
        if (!tile.featureCollection) {
            return;
        }
        
        tile.featureCollection.features.forEach(feature => {
            const fid = (feature as any).__fid;
            if (fid == undefined) {
                return;
            }
            if (!(fid in this.featureHolders)) {
                return;
            }

            var unmaskNext = false;
            if (this.featureHolders[fid][0] != tile.key) {
                tile.unmaskFeature(fid);
            } else {
                unmaskNext = true;
            }
            this.featureHolders[fid] = this.featureHolders[fid].filter(key => key != tile.key);

            if (unmaskNext && this.featureHolders[fid].length > 0) {
                // need to unmask the feature in the next feature holder in the list
                const nextTile = this.tiles[this.featureHolders[fid][0]];
                nextTile.unmaskFeature(fid);
            }
        });

        for (const fid of Object.keys(this.featureHolders)) {
            const keys = this.featureHolders[Number(fid)];

            for (const key of keys) {
                if (tile.key == key) {
                    console.log(`Failed to remove holder tile: ${tile.key}, fid: ${fid}`)
                }
            }
        }
    }

    // Load the tile at the given location.
    private loadTile(x: number, y: number) {
        const key = TiledGeoJSONTile.tileKey(x, y);
        if (!(key in this.meta.tiles)) {
            return undefined;
        }

        // TODO avoid loading same hash twice
        if (!(key in this.tiles)) {
            const hash = this.meta.tiles[key];
            this.tiles[key] = new TiledGeoJSONTile(this, key, hash, tile => {
                if (tile.key in this.activeTiles) {
                    this.addFeatureHolders(tile);
                    this.addLayer(tile);
                }
            }, this.options);
        }

        return this.tiles[key];
    }

}

class TiledGeoJSONTile extends L.GeoJSON {
    fulfilled: boolean = false;
    featureCollection?: FeatureCollection;
    maskedFeatures: Record<number, Feature> = {};
    featureLayers: Record<number, L.Layer> = {};

    constructor(
        readonly lod: TiledGeoJSONLod,
        public readonly key: string,
        public readonly hash: string,
        private loadCallback?: (tile: TiledGeoJSONTile) => void,
        options?: L.LayerOptions
    ) {
        super(undefined, options);
        this.loadTile();
    }

    // Load the tile data with callback.
    private loadTile(retryTime = 1) {
        fetch(`${this.lod.tiledGeoJson.endpoint}/tiles/${this.hash}.json`).then(response => response.text()).then(text => {
            const tileData = JSON.parse(text) as TiledGeoJSONTileData;
            const geojson: FeatureCollection = {
                type: 'FeatureCollection',
                features: tileData.features
            };

            this.featureCollection = geojson;
            this.fulfilled = true;

            this.addData(this.featureCollection);

            if (this.loadCallback) {
                this.loadCallback(this);
            }
        }).catch(err => {
            console.error(`Failed to load tile ${this.key}. Will retry in ${retryTime} seconds.`, err);
            setTimeout(() => this.loadTile(retryTime * 2), retryTime * 1000);
        });
    }

    public addLayer(layer: L.Layer): this {
        this.featureLayers[(layer as any).feature.__fid] = layer;
        return super.addLayer(layer);
    }

    // Hide a feature from being displayed as part of this tile
    public maskFeature(fid: number) {
        if (!this.featureCollection) {
            return;
        }
        for (const feat of this.featureCollection.features) {
            if ((feat as any).__fid == fid) {
                this.maskedFeatures[fid] = feat;
            }
        }
        this.removeLayer(this.featureLayers[fid]);
    }

    // Unhide a hidden feature to display it as part of this tile
    public unmaskFeature(fid: number) {
        const feat = this.maskedFeatures[fid];
        if (!feat) {
            return;
        }
        delete this.maskedFeatures[fid];
        this.addLayer(this.featureLayers[fid]);
    }

    // Unhide all hidden features.
    public unmaskAll() {
        for (var fid of Object.keys(this.maskedFeatures)) {
            const fidNum = Number(fid);
            this.addLayer(this.featureLayers[fidNum]);
            delete this.maskedFeatures[fidNum];
        }
    }

    // Convert coordinates to a string key.
    static tileKey(x: number, y: number) {
        return `${x},${y}`;
    }
    
}

class GridView {
    public resolution: number; // the side-lengths of the grid squares
    public minX: number; // the longitude of the southernmost grid square (up to the resolution)
    public minY: number; // the latitude of the westernmost grid square (up to the resolution)
    public stepsX: number; // how many grid squares are in view to the north of the southernmost square
    public stepsY: number; // how many grid squares are in view to the east of the westernmost square

    constructor(resolution: number, originX: number, originY: number, mapBounds: L.LatLngBounds) {
        this.resolution = resolution;
        this.minX = Math.floor((mapBounds.getWest() - originX) / resolution);
        this.minY = Math.floor((mapBounds.getSouth() - originY) / resolution);
        this.stepsX = Math.ceil((mapBounds.getEast() - originX) / resolution) - this.minX;
        this.stepsY = Math.ceil((mapBounds.getNorth() - originY) / resolution) - this.minY;
    }

    public sameAs(otherView: GridView): boolean {
        return (otherView.resolution === this.resolution
            && otherView.minX === this.minX
            && otherView.minY === this.minY
            && otherView.stepsX === this.stepsX
            && otherView.stepsY === this.stepsY);
    }
}

/**
 * Creates a tiled geojson layer.
 * @param endpoint the path to the location the tiled geojson data is stored.
 * @param options layer options - includes same options as a normal GeoJSON layer.
 * @returns the tiled geojson layer.
 */
export function tiledGeoJSON(endpoint: string, options?: TiledGeoJSONOptions): TiledGeoJSON {
    return new TiledGeoJSON(endpoint, options);
}

// Extend Leaflet namespace
declare module 'leaflet' {
    function tiledGeoJSON(options?: TiledGeoJSONOptions): TiledGeoJSON;
}

// Add to L namespace if available
if (typeof window !== 'undefined' && (window as any).L) {
    (window as any).L.tiledGeoJSON = tiledGeoJSON;
    (window as any).L.TiledGeoJSON = TiledGeoJSON;
}
