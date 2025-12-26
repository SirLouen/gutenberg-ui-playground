<?php
/**
 * Plugin Name: Gutenberg UI Playground
 * Description: A playground to test Gutenberg UI components.
 * Version: 1.0.0
 * Author: SirLouen <sir.louen@gmail.com>
 * License: GPL2+
 * License URI: https://www.gnu.org/licenses/gpl-2.0.txt
 * Text Domain: gutenberg-ui-playground
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// Option name for storing the playground code.
define( 'GUTENBERG_UI_PLAYGROUND_OPTION', 'gutenberg_ui_playground_code' );

add_action( 'admin_menu', function () {
	add_menu_page(
		'Gutenberg UI Playground',
		'GB UI Playground',
		'manage_options',
		'gutenberg-ui-playground',
		function () {
			echo '<div id="gutenberg-ui-playground-root"></div>';
		},
		'dashicons-editor-code',
		100
	);
} );

add_action( 'admin_enqueue_scripts', function ( $hook ) {
	if ( 'toplevel_page_gutenberg-ui-playground' !== $hook ) {
		return;
	}

	$asset_file = __DIR__ . '/build/index.asset.php';
	if ( ! file_exists( $asset_file ) ) {
		return;
	}

	$asset = include $asset_file;

	// Load Babel from CDN for JSX transformation.
	wp_register_script(
		'babel-standalone',
		'https://unpkg.com/@babel/standalone@7.28.5/babel.min.js',
		array(),
		'7.28.5',
		true
	);

	wp_enqueue_script(
		'gutenberg-ui-playground',
		plugins_url( 'build/index.js', __FILE__ ),
		array_merge( $asset['dependencies'], array( 'babel-standalone' ) ),
		$asset['version'],
		true
	);

	// Pass REST API info to JavaScript.
	wp_localize_script(
		'gutenberg-ui-playground',
		'gutenbergUiPlayground',
		array(
			'restUrl'   => rest_url( 'gutenberg-ui-playground/v1/' ),
			'nonce'     => wp_create_nonce( 'wp_rest' ),
			'pluginZip' => 'https://github.com/SirLouen/gutenberg-ui-playground/raw/refs/heads/trunk/dist/gutenberg-ui-playground.zip',
		)
	);

	wp_enqueue_style(
		'gutenberg-ui-playground',
		plugins_url( 'build/style-index.css', __FILE__ ),
		array(),
		$asset['version']
	);
} );

// Register REST API endpoints.
add_action( 'rest_api_init', function () {
	// Get saved code.
	register_rest_route(
		'gutenberg-ui-playground/v1',
		'/code',
		array(
			'methods'             => 'GET',
			'callback'            => function () {
				$code = get_option( GUTENBERG_UI_PLAYGROUND_OPTION, '' );
				return rest_ensure_response( array( 'code' => $code ) );
			},
			'permission_callback' => function () {
				return current_user_can( 'manage_options' );
			},
		)
	);

	// Save code.
	register_rest_route(
		'gutenberg-ui-playground/v1',
		'/code',
		array(
			'methods'             => 'POST',
			'callback'            => function ( $request ) {
				$code = $request->get_param( 'code' );
				update_option( GUTENBERG_UI_PLAYGROUND_OPTION, $code );
				return rest_ensure_response( array( 'success' => true ) );
			},
			'permission_callback' => function () {
				return current_user_can( 'manage_options' );
			},
			'args'                => array(
				'code' => array(
					'required'          => true,
					'type'              => 'string',
					'sanitize_callback' => function ( $value ) {
						return $value; // Keep raw code, no sanitization needed.
					},
				),
			),
		)
	);
} );
