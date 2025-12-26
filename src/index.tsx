import { createRoot, useState, useEffect, useCallback, Component } from '@wordpress/element';
import * as UI from '@wordpress/ui';
import '@wordpress/theme/design-tokens.css';
import './style.css';

// Babel is loaded from CDN
declare const Babel: { transform: ( code: string, options: object ) => { code: string | null } };

// WordPress localized data
declare const gutenbergUiPlayground: {
	restUrl: string;
	nonce: string;
	githubToken: string;
	settingsUrl: string;
};

// Make UI components available for the playground
const PlaygroundScope = { ...UI, useState, useEffect, useCallback };

const DEFAULT_CODE = `<Field.Root>
  <Field.Label>Label</Field.Label>
  <Field.Control
    render={ <input type="text" placeholder="Insert something here" /> }
  />
  <Field.Description>
    Field Description
  </Field.Description>
</Field.Root>`;

// API functions
async function fetchSavedCode(): Promise< string > {
	try {
		const response = await fetch( `${ gutenbergUiPlayground.restUrl }code`, {
			headers: {
				'X-WP-Nonce': gutenbergUiPlayground.nonce,
			},
		} );
		const data = await response.json();
		return data.code || '';
	} catch {
		return '';
	}
}

async function saveCodeToDatabase( code: string ): Promise< boolean > {
	try {
		const response = await fetch( `${ gutenbergUiPlayground.restUrl }code`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-WP-Nonce': gutenbergUiPlayground.nonce,
			},
			body: JSON.stringify( { code } ),
		} );
		const data = await response.json();
		return data.success;
	} catch {
		return false;
	}
}

async function createGist( blueprint: object, token: string ): Promise< string | null > {
	try {
		const response = await fetch( 'https://api.github.com/gists', {
			method: 'POST',
			headers: {
				'Accept': 'application/vnd.github+json',
				'Authorization': `Bearer ${ token }`,
				'X-GitHub-Api-Version': '2022-11-28',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify( {
				description: 'Gutenberg UI Playground Blueprint',
				public: true,
				files: {
					'blueprint.json': {
						content: JSON.stringify( blueprint, null, 2 ),
					},
				},
			} ),
		} );

		if ( ! response.ok ) {
			const error = await response.json();
			throw new Error( error.message || 'Failed to create gist' );
		}

		const data = await response.json();
		// Return the raw URL for the blueprint.json file
		return data.files[ 'blueprint.json' ].raw_url;
	} catch ( e ) {
		console.error( 'Failed to create gist:', e );
		return null;
	}
}

async function fetchPluginZipBase64(): Promise< string | null > {
	try {
		const response = await fetch( `${ gutenbergUiPlayground.restUrl }plugin-zip`, {
			headers: {
				'X-WP-Nonce': gutenbergUiPlayground.nonce,
			},
		} );
		const text = await response.text();
		try {
			const data = JSON.parse( text );
			if ( ! response.ok ) {
				console.error( 'Failed to fetch plugin ZIP:', data );
				return null;
			}
			return data.base64 || null;
		} catch {
			console.error( 'PHP Error:', text );
			return null;
		}
	} catch ( e ) {
		console.error( 'Error fetching plugin ZIP:', e );
		return null;
	}
}

// Generate blueprint.json
function generateBlueprint( code: string, pluginZipBase64?: string ): object {
	// Use data URL if base64 is provided, otherwise use a placeholder
	const pluginZipUrl = pluginZipBase64
		? `data:application/zip;base64,${ pluginZipBase64 }`
		: 'PLUGIN_ZIP_PLACEHOLDER';

	return {
		$schema: 'https://playground.wordpress.net/blueprint-schema.json',
		preferredVersions: {
			php: '8.3',
			wp: 'trunk',
		},
		features: {
			networking: true,
		},
		login: true,
		landingPage: '/wp-admin/admin.php?page=gutenberg-ui-playground',
		steps: [
			{
				step: 'mkdir',
				path: '/tmp/gutenberg',
			},
			{
				step: 'writeFile',
				path: '/tmp/gutenberg/artifact.zip',
				data: {
					resource: 'url',
					url: '/plugin-proxy.php?org=WordPress&repo=gutenberg&workflow=Build%20Gutenberg%20Plugin%20Zip&artifact=gutenberg-plugin&branch=trunk',
					caption: 'Downloading Gutenberg branch trunk',
				},
			},
			{
				step: 'unzip',
				zipPath: '/tmp/gutenberg/artifact.zip',
				extractToPath: '/tmp/gutenberg',
			},
			{
				step: 'installPlugin',
				pluginData: {
					resource: 'vfs',
					path: '/tmp/gutenberg/gutenberg.zip',
				},
			},
			{
				step: 'installPlugin',
				pluginData: {
					resource: 'url',
					url: pluginZipUrl,
				},
			},
			{
				step: 'runPHP',
				code: `<?php
require_once 'wordpress/wp-load.php';
update_option( 'gutenberg_ui_playground_code', ${ JSON.stringify( code ) } );
echo 'Playground code installed successfully.';
`,
			},
		],
	};
}

// Error Boundary to catch render errors
class ErrorBoundary extends Component<
	{ children: React.ReactNode },
	{ error: Error | null }
> {
	state = { error: null };

	static getDerivedStateFromError( error: Error ) {
		return { error };
	}

	componentDidUpdate( prevProps: { children: React.ReactNode } ) {
		if ( prevProps.children !== this.props.children ) {
			this.setState( { error: null } );
		}
	}

	render() {
		if ( this.state.error ) {
			return (
				<div className="playground-error">
					<strong>Render Error:</strong>
					<pre>{ ( this.state.error as Error ).message }</pre>
				</div>
			);
		}
		return this.props.children;
	}
}

function Preview( { code }: { code: string } ) {
	const [ Component, setComponent ] = useState<React.FC | null>( null );
	const [ error, setError ] = useState< string | null >( null );

	useEffect( () => {
		try {
			// Transform JSX to JavaScript using Babel (loaded from CDN)
			const transformed = Babel.transform(
				`(function(${Object.keys( PlaygroundScope ).join( ', ' )}) { return (<>${ code }</>); })`,
				{
					presets: [ 'react' ],
					filename: 'playground.tsx',
				}
			);

			if ( ! transformed.code ) {
				throw new Error( 'Failed to transform code' );
			}

			// eslint-disable-next-line no-eval
			const fn = eval( transformed.code );
			const scopeValues = Object.values( PlaygroundScope );
			const ComponentFn = () => fn( ...scopeValues );
			setComponent( () => ComponentFn );
			setError( null );
		} catch ( e ) {
			setError( ( e as Error ).message );
			setComponent( null );
		}
	}, [ code ] );

	if ( error ) {
		return (
			<div className="playground-error">
				<strong>Syntax Error:</strong>
				<pre>{ error }</pre>
			</div>
		);
	}

	if ( ! Component ) {
		return <div className="playground-empty">Enter some code to preview</div>;
	}

	return (
		<ErrorBoundary>
			<Component />
		</ErrorBoundary>
	);
}

function BlueprintGenerator( { code }: { code: string } ) {
	const [ copied, setCopied ] = useState( false );
	const [ isUploading, setIsUploading ] = useState( false );
	const [ gistUrl, setGistUrl ] = useState< string | null >( null );
	const [ error, setError ] = useState< string | null >( null );

	const hasToken = Boolean( gutenbergUiPlayground.githubToken );
	// Preview blueprint without the embedded ZIP (shows placeholder)
	const previewBlueprint = generateBlueprint( code );
	const blueprintJson = JSON.stringify( previewBlueprint, null, 2 )
		.replace( '"PLUGIN_ZIP_PLACEHOLDER"', '"data:application/zip;base64,..."' );

	const handleCopy = async () => {
		await navigator.clipboard.writeText( blueprintJson );
		setCopied( true );
		setTimeout( () => setCopied( false ), 2000 );
	};

	const handleUploadToGist = async () => {
		if ( ! hasToken ) {
			return;
		}

		setIsUploading( true );
		setError( null );

		// Fetch the plugin ZIP as base64
		const pluginZipBase64 = await fetchPluginZipBase64();
		if ( ! pluginZipBase64 ) {
			setError( 'Failed to generate plugin ZIP.' );
			setIsUploading( false );
			return;
		}

		// Generate blueprint with embedded ZIP
		const blueprint = generateBlueprint( code, pluginZipBase64 );

		const rawUrl = await createGist( blueprint, gutenbergUiPlayground.githubToken );
		if ( rawUrl ) {
			setGistUrl( rawUrl );
		} else {
			setError( 'Failed to create gist. Check your token permissions in Settings.' );
		}
		setIsUploading( false );
	};

	const handleOpenPlayground = () => {
		if ( gistUrl ) {
			// Use the gist URL
			window.open(
				`https://playground.wordpress.net/?blueprint-url=${ encodeURIComponent( gistUrl ) }`,
				'_blank'
			);
		} else {
			setError( 'Please upload to Gist first to open in Playground.' );
		}
	};

	// Reset gist URL when code changes
	useEffect( () => {
		setGistUrl( null );
	}, [ code ] );

	return (
		<div className="playground-blueprint">
			<div className="playground-header">
				<h2>WordPress Playground Blueprint</h2>
				<div className="playground-actions">
					<button
						className="button button-secondary"
						onClick={ handleCopy }
					>
						{ copied ? 'Copied!' : 'Copy JSON' }
					</button>
					{ hasToken ? (
						<button
							className="button button-secondary"
							onClick={ handleUploadToGist }
							disabled={ isUploading }
						>
							{ isUploading ? 'Uploading...' : gistUrl ? '✓ Uploaded to Gist' : 'Upload to Gist' }
						</button>
					) : (
						<a
							className="button button-secondary"
							href={ gutenbergUiPlayground.settingsUrl }
						>
							Configure GitHub Token
						</a>
					) }
					<button
						className="button button-primary"
						onClick={ handleOpenPlayground }
						disabled={ ! gistUrl }
					>
						Open in Playground
					</button>
				</div>
			</div>
			{ error && <div className="playground-error">{ error }</div> }
			{ gistUrl && (
				<div className="playground-gist-url">
					<strong>Gist URL:</strong>{ ' ' }
					<a href={ gistUrl } target="_blank" rel="noopener noreferrer">{ gistUrl }</a>
				</div>
			) }
			<pre className="playground-blueprint-code">{ blueprintJson }</pre>
		</div>
	);
}

function Playground() {
	const [ code, setCode ] = useState( DEFAULT_CODE );
	const [ savedCode, setSavedCode ] = useState( DEFAULT_CODE );
	const [ isLoading, setIsLoading ] = useState( true );
	const [ isSaving, setIsSaving ] = useState( false );

	// Load saved code from database on mount.
	useEffect( () => {
		fetchSavedCode().then( ( dbCode ) => {
			if ( dbCode ) {
				setCode( dbCode );
				setSavedCode( dbCode );
			}
			setIsLoading( false );
		} );
	}, [] );

	const handleSave = async () => {
		setIsSaving( true );
		const success = await saveCodeToDatabase( code );
		if ( success ) {
			setSavedCode( code );
		}
		setIsSaving( false );
	};

	const handleReset = async () => {
		setCode( DEFAULT_CODE );
		setIsSaving( true );
		await saveCodeToDatabase( DEFAULT_CODE );
		setSavedCode( DEFAULT_CODE );
		setIsSaving( false );
	};

	const hasChanges = code !== savedCode;

	if ( isLoading ) {
		return <div className="playground-loading">Loading...</div>;
	}

	return (
		<>
			<div className="playground-container">
				<div className="playground-editor">
					<div className="playground-header">
						<h2>Code</h2>
						<div className="playground-actions">
							<button
								className="button button-secondary"
								onClick={ handleReset }
								disabled={ isSaving }
							>
								Reset
							</button>
							<button
								className="button button-primary"
								onClick={ handleSave }
								disabled={ ! hasChanges || isSaving }
							>
								{ isSaving ? 'Saving...' : hasChanges ? 'Save' : 'Saved' }
							</button>
						</div>
					</div>
					<textarea
						className="playground-textarea"
						value={ code }
						onChange={ ( e ) => setCode( e.target.value ) }
						spellCheck={ false }
					/>
				<div className="playground-hint">
					<strong>Available components:</strong> { Object.keys( UI ).join( ', ' ) }
				</div>
			</div>
			<div className="playground-preview">
				<div className="playground-header">
					<h2>Preview</h2>
				</div>
				<div className="playground-preview-content">
					<Preview code={ code } />
				</div>
			</div>
		</div>
		<BlueprintGenerator code={ code } />
		</>
	);
}

function App() {
	return (
		<div className="gutenberg-ui-playground">
			<h1>Gutenberg UI Playground</h1>
			<Playground />
		</div>
	);
}

const container = document.getElementById( 'gutenberg-ui-playground-root' );
if ( container ) {
	createRoot( container ).render( <App /> );
}
