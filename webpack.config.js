const path = require( 'path' );
const defaultConfig = require( '@wordpress/scripts/config/webpack.config' );
const DependencyExtractionWebpackPlugin = require( '@wordpress/dependency-extraction-webpack-plugin' );
const {
	defaultRequestToExternal,
	defaultRequestToHandle,
} = require( '@wordpress/dependency-extraction-webpack-plugin/lib/util' );

const gutenbergPackages = path.resolve( __dirname, '../gutenberg/packages' );
const localNodeModules = path.resolve( __dirname, 'node_modules' );

// Packages to bundle instead of externalizing
const bundledPackages = [ '@wordpress/ui', '@wordpress/theme' ];

const shouldBundle = ( request ) =>
	bundledPackages.some( ( pkg ) => request.startsWith( pkg ) );

module.exports = {
	...defaultConfig,
	externals: {
		...defaultConfig.externals,
		'@babel/standalone': 'Babel',
	},
	resolve: {
		...defaultConfig.resolve,
		alias: {
			...defaultConfig.resolve?.alias,
			// Exact match for the CSS import (must be before @wordpress/theme)
			'@wordpress/theme/design-tokens.css$': path.resolve(
				gutenbergPackages,
				'theme/src/prebuilt/css/design-tokens.css'
			),
			'@wordpress/ui': path.resolve( gutenbergPackages, 'ui/src' ),
			'@wordpress/theme$': path.resolve( gutenbergPackages, 'theme' ),
		},
		// Ensure our local node_modules are found first for packages the Gutenberg
		// source files depend on
		modules: [ localNodeModules, 'node_modules' ],
	},
	plugins: [
		...defaultConfig.plugins.filter(
			( plugin ) =>
				plugin.constructor.name !== 'DependencyExtractionWebpackPlugin'
		),
		new DependencyExtractionWebpackPlugin( {
			useDefaults: false,
			requestToExternal( request ) {
				if ( shouldBundle( request ) ) {
					return undefined;
				}
				return defaultRequestToExternal( request );
			},
			requestToHandle( request ) {
				if ( shouldBundle( request ) ) {
					return undefined;
				}
				return defaultRequestToHandle( request );
			},
		} ),
	],
};
