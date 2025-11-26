import typescript from '@rollup/plugin-typescript';

export default {
  input: 'src/index.ts',
  output: {
    file: 'dist/leaflet-tiled-geojson.js',
    format: 'umd',
    name: 'L.TiledGeoJSON',
    globals: {
      leaflet: 'L'
    },
    sourcemap: true
  },
  external: ['leaflet'],
  plugins: [
    typescript({
      tsconfig: './tsconfig.json'
    })
  ]
};
