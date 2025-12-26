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
define( 'GUTENBERG_UI_PLAYGROUND_TOKEN_OPTION', 'gutenberg_ui_playground_github_token' );

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

	add_submenu_page(
		'gutenberg-ui-playground',
		'Settings',
		'Settings',
		'manage_options',
		'gutenberg-ui-playground-settings',
		'gutenberg_ui_playground_settings_page'
	);
} );

/**
 * Render the settings page.
 */
function gutenberg_ui_playground_settings_page() {
	$token = get_option( GUTENBERG_UI_PLAYGROUND_TOKEN_OPTION, '' );

	if ( isset( $_POST['gutenberg_ui_playground_save_settings'] ) && check_admin_referer( 'gutenberg_ui_playground_settings' ) ) {
		$token = isset( $_POST['github_token'] ) ? sanitize_text_field( wp_unslash( $_POST['github_token'] ) ) : '';
		update_option( GUTENBERG_UI_PLAYGROUND_TOKEN_OPTION, $token );
		echo '<div class="notice notice-success"><p>Settings saved.</p></div>';
	}
	?>
	<div class="wrap">
		<h1>Gutenberg UI Playground Settings</h1>
		<form method="post">
			<?php wp_nonce_field( 'gutenberg_ui_playground_settings' ); ?>
			<table class="form-table">
				<tr>
					<th scope="row">
						<label for="github_token">GitHub Personal Access Token</label>
					</th>
					<td>
						<input
							type="password"
							id="github_token"
							name="github_token"
							value="<?php echo esc_attr( $token ); ?>"
							class="regular-text"
						/>
						<p class="description">
							Create a token at
							<a href="https://github.com/settings/tokens/new?scopes=gist" target="_blank" rel="noopener noreferrer">
								GitHub Settings
							</a>
							with the <code>gist</code> scope. This is used to upload blueprints as GitHub Gists.
						</p>
					</td>
				</tr>
			</table>
			<p class="submit">
				<input
					type="submit"
					name="gutenberg_ui_playground_save_settings"
					class="button button-primary"
					value="Save Settings"
				/>
			</p>
		</form>
	</div>
	<?php
}

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
			'restUrl'     => rest_url( 'gutenberg-ui-playground/v1/' ),
			'nonce'       => wp_create_nonce( 'wp_rest' ),
			'githubToken' => get_option( GUTENBERG_UI_PLAYGROUND_TOKEN_OPTION, '' ),
			'settingsUrl' => admin_url( 'admin.php?page=gutenberg-ui-playground-settings' ),
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

	// Get plugin ZIP as base64.
	register_rest_route(
		'gutenberg-ui-playground/v1',
		'/plugin-zip',
		array(
			'methods'             => 'GET',
			'callback'            => 'gutenberg_ui_playground_get_plugin_zip',
			'permission_callback' => function () {
				return current_user_can( 'manage_options' );
			},
		)
	);
} );

/**
 * Generate and return the plugin ZIP as base64.
 *
 * @return WP_REST_Response|WP_Error Response with base64 ZIP or error.
 */
function gutenberg_ui_playground_get_plugin_zip() {
	$plugin_dir = __DIR__;
	$build_dir  = $plugin_dir . '/build';

	// Check if build directory exists.
	if ( ! is_dir( $build_dir ) ) {
		return new WP_Error( 'build_missing', 'Build directory does not exist. Run npm run build first.', array( 'status' => 500 ) );
	}

	// Use PHP's tempnam instead of wp_tempnam (not available in REST context).
	$zip_file = tempnam( sys_get_temp_dir(), 'gutenberg-ui-playground' ) . '.zip';

	if ( ! class_exists( 'ZipArchive' ) ) {
		return new WP_Error( 'zip_missing', 'ZipArchive class not available', array( 'status' => 500 ) );
	}

	$zip = new ZipArchive();
	if ( true !== $zip->open( $zip_file, ZipArchive::CREATE | ZipArchive::OVERWRITE ) ) {
		return new WP_Error( 'zip_error', 'Failed to create ZIP file', array( 'status' => 500 ) );
	}

	// Add main plugin file.
	if ( ! $zip->addFile( $plugin_dir . '/gutenberg-ui-playground.php', 'gutenberg-ui-playground/gutenberg-ui-playground.php' ) ) {
		$zip->close();
		return new WP_Error( 'zip_error', 'Failed to add main plugin file', array( 'status' => 500 ) );
	}

	// Add build directory.
	$build_files = new RecursiveIteratorIterator(
		new RecursiveDirectoryIterator( $build_dir, RecursiveDirectoryIterator::SKIP_DOTS ),
		RecursiveIteratorIterator::LEAVES_ONLY
	);

	foreach ( $build_files as $file ) {
		if ( ! $file->isDir() && '.map' !== substr( $file->getFilename(), -4 ) ) {
			$file_path     = $file->getRealPath();
			$relative_path = 'gutenberg-ui-playground/build/' . substr( $file_path, strlen( $build_dir ) + 1 );
			$zip->addFile( $file_path, $relative_path );
		}
	}

	$zip->close();

	// Read and encode.
	if ( ! file_exists( $zip_file ) ) {
		return new WP_Error( 'zip_error', 'ZIP file was not created', array( 'status' => 500 ) );
	}

	$zip_contents = file_get_contents( $zip_file );
	if ( false === $zip_contents ) {
		return new WP_Error( 'zip_error', 'Failed to read ZIP file', array( 'status' => 500 ) );
	}

	$base64 = base64_encode( $zip_contents );

	// Clean up.
	unlink( $zip_file );

	return rest_ensure_response(
		array(
			'base64' => $base64,
			'size'   => strlen( $zip_contents ),
		)
	);
}
