const { app, shell, BrowserWindow, ipcMain, protocol, powerSaveBlocker, dialog } = require('electron');
const config = require('./config.json');
const environment = require('./environment.json');
const ElectronStore = require('electron-store');
const RichPresence = require('discord-rich-presence');
const path = require('path');
const os = require('os');

app.commandLine.appendSwitch('--disable-gpu-sandbox');
app.commandLine.appendSwitch('--enable-webgl2-compute-context');
app.commandLine.appendSwitch('--lang', 'en-US');
app.commandLine.appendSwitch('--no-sandbox');
app.commandLine.appendSwitch('--force-discrete-gpu', '1');
app.commandLine.appendSwitch('--enable-high-resolution-time');
app.commandLine.appendSwitch('--enable-zero-copy');
app.commandLine.appendSwitch('--ignore-gpu-blacklist');
app.commandLine.appendSwitch('--autoplay-policy', 'no-user-gesture-required');

app.setAsDefaultProtocolClient('tetrio');

// ensure only 1 instance may be open
const primary = app.requestSingleInstanceLock();
if (!primary) {
    app.quit();
    return;
}

let discordIPC = null;
const store = new ElectronStore();
powerSaveBlocker.start('prevent-display-sleep');

if (!store.get('emergency', false)) {
	if (!store.get('vsync', false)) {
		app.commandLine.appendSwitch('--disable-frame-rate-limit');
		app.commandLine.appendSwitch('--disable-gpu-vsync');
	}

	// try to connect IPC
	try {
		discordIPC = RichPresence(config.discord_client_id);
		discordIPC.on('error', ()=>{
			discordIPC = RichPresence(config.discord_client_id);
		});
	} catch (ex) {}
} else {
	// disable in future
	setTimeout(() => {
		store.set('emergency', false);
	}, 10000);
}

if (store.get('anglecompat', false)) {
	app.commandLine.appendSwitch('--use-angle', 'gl');
}


let mainWindow = null;
let blockMovement = true;
const targetAddress = (process.argv[1] && process.argv[1].includes('tetrio://')) ? `${ config.target }#${ process.argv[1].replace('tetrio://', '').replace('/', '') }` : config.target;

function createWindow() {
	// Create the browser window
	const win = new BrowserWindow({
		title: 'TETR.IO',
		show: true,
		width: store.get('window-width', 1600),
		height: store.get('window-height', 800),
		fullscreen: store.get('window-fullscreen', false),
		minWidth: 800,
		minHeight: 400,
		useContentSize: true,
		backgroundColor: '#000000',
		fullscreenable: true,
		webPreferences: {
			nodeIntegration: false,
			nodeIntegrationInSubFrames: false,
			enableRemoteModule: false,
			contextIsolation: false,
			preload: path.join(__dirname, 'preload.js'),
			backgroundThrottling: false,
			nativeWindowOpen: true,
			disableBlinkFeatures: 'PreloadMediaEngagementData,AutoplayIgnoreWebAudio,MediaEngagementBypassAutoplayPolicies'
		}
	});
	if (store.get('window-maximized', false)) {
		win.maximize();
	}
	win.setMenu(null);

	// Open outlinks in normal browser
	win.webContents.on('new-window', (e, url, frameName, disposition, options) => {
		if (!blockMovement) {
			if (options.webPreferences) {
				options.webPreferences.nodeIntegration = false;
				options.webPreferences.nativeWindowOpen = true;
			} else {
				options.webPreferences = { nodeIntegration: false, nativeWindowOpen: true };
			}
			return;
		}
        e.preventDefault();
        shell.openExternal(url);
    });
    win.webContents.on('will-navigate', (e, url) => {
		if (!blockMovement) { return; }
        if (url !== win.webContents.getURL() && !url.startsWith(targetAddress)) {
            e.preventDefault();
            shell.openExternal(url);
        }
    });
    win.webContents.on('did-create-window', (newWindow) => {
		newWindow.setMenu(null);
    });

    // Update store data when closed / maximized
    win.on('close', () => {
        store.set('window-width', win.getBounds().width);
        store.set('window-height', win.getBounds().height);
        store.set('window-maximized', win.isMaximized());
        store.set('window-fullscreen', win.isFullScreen());
    });

    win.on('closed', () => {
        mainWindow = null; // Dereference our main window
    });

    const crashStrings = {
    	'abnormal-exit': 'Renderer crashed (process exited with a non-zero exit code)! Report this to osk.',
    	'killed': 'Renderer crashed (process terminated unexpectedly)!',
    	'crashed': 'Renderer crashed (Chromium engine crashed)! Report this to osk.',
    	'oom': 'Renderer crashed (out of memory)! Report this to osk.',
    	'launch-failure': 'TETR.IO failed to open. Report this to osk.',
    	'integrity-failure': 'Renderer crashed (code integrity checks failed)! Report this to osk.'
    };
    win.webContents.on('render-process-gone', (e, details) => {
    	if (details.reason === 'clean-exit') {
    		return;
    	}

        dialog.showMessageBoxSync({
        	message: crashStrings[details.reason] || 'Renderer crashed! Report this to osk.',
        	type: 'error'
        });
    });

    // Initialize loader
    win.webContents.on('dom-ready', () => {
        win.webContents.executeJavaScript(`window.EMERGENCY_MODE = ${ store.get('emergency', false) ? 'true' : 'false' }; window.VSYNC_ON = ${ store.get('vsync', false) ? 'true' : 'false' }; window.TARGET_ADDRESS = '${ targetAddress.replace(`'`, `\\'`) }'; window.UPDATER_ADDRESS = '${ config.updater_target.replace(`'`, `\\'`) }'; window.UPDATER_SITE = '${ config.updater_site.replace(`'`, `\\'`) }'; window.CLIENT_VERSION = ${ environment.version }; window.PLATFORM_TYPE = '${ process.platform }'; if (window.StartLoader) { StartLoader(); }`);
    });

	win.loadFile('index.html'); // loader

	mainWindow = win;
}

app.whenReady().then(() => {
	try {
		createWindow();
	} catch (ex) {}
});

// Quit when all windows are closed.
app.on('window-all-closed', () => {
	app.quit();
});

// On macOS URLs get sent through this event
app.on('open-url', (e, url) => {
	try {
		if (url.startsWith('/')) {
			url = url.substr(1);
		}

		if (mainWindow) {
			mainWindow.webContents.send('goto', `${ config.target }#${ url.replace('tetrio://', '').replace('/', '') }`);
			mainWindow.show();
		}
	} catch (ex) {}
});

// On other places, this is what the URL will be sent to (by the second instance)
app.on('second-instance', (event, argv) => {
	try {
		argv.forEach((arg) => {
	    	if (arg.startsWith('tetrio://')) {
	    		if (mainWindow) {
	    			mainWindow.webContents.send('goto', `${ config.target }#${ arg.replace('tetrio://', '').replace('/', '') }`);
					mainWindow.show();
				}
	    	}
	    });
	} catch (ex) {}    
});

// Discord Rich Presence
ipcMain.on('presence', (e, arg) => {
	if (discordIPC === null) { return; }
	try {
		discordIPC.updatePresence(arg);
	} catch (ex) {}
});

// Hold F4 to enable emergency mode
ipcMain.on('emergency', (e) => {
	store.set('emergency', true);
	app.relaunch();
	app.exit(0);
});

// Use config to en/disable VSync
ipcMain.on('vsync', (e, newvalue) => {
	store.set('vsync', !!newvalue);
});

// Press CTRL-SHIFT-I or F12 for devtools
ipcMain.on('devtools', (e) => {
	if (!mainWindow) { return; }
	mainWindow.toggleDevTools();
});

// Press F11 for full screen
ipcMain.on('fullscreen', (e) => {
	if (!mainWindow) { return; }
	mainWindow.setFullScreen(!mainWindow.isFullScreen());
});

// Close handler
ipcMain.on('close', (e) => {
	if (!mainWindow) { return; }
	store.set('window-width', mainWindow.getBounds().width);
    store.set('window-height', mainWindow.getBounds().height);
    store.set('window-maximized', mainWindow.isMaximized());
    store.set('window-fullscreen', mainWindow.isFullScreen());
	mainWindow.close();
});

// Flash handler
ipcMain.on('flash', (e) => {
	if (!mainWindow) { return; }
	mainWindow.once('focus', () => { mainWindow.flashFrame(false); });
	mainWindow.flashFrame(true);
});

// ANGLE compatibility help
ipcMain.on('anglecompat', (e, arg) => {
	if (!mainWindow) { return; }
	store.set('anglecompat', arg);
});

// Nuke caches
ipcMain.on('nuke', (e) => {
	if (!mainWindow) { return; }

	try {
		// New Electron
		mainWindow.webContents.session.clearCache().then(() => {
			return mainWindow.webContents.session.clearStorageData({
				storages: ['appcache', 'shadercache', 'serviceworkers', 'cachestorage']
			});
		}).then(() => {
			mainWindow.reload();
		});
	} catch (ex) {
		// Old Electron
		mainWindow.webContents.session.clearCache(() => {
			mainWindow.webContents.session.clearStorageData({
				storages: ['appcache', 'shadercache', 'serviceworkers', 'cachestorage'],
			}, () => {
				mainWindow.reload();
			});
		});
	}	
});

// Allow/disallow opening secondary windows
ipcMain.on('blockmovement', (e, newvalue) => {
	blockMovement = !!newvalue;
});