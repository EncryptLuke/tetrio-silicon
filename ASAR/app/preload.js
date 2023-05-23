window.IS_ELECTRON = true;
window.IPC = require('electron').ipcRenderer;
window.BASEBOARD = undefined;
window.REFRESH_RATE = 60;

const si = require('systeminformation');
si.baseboard()
	.then((data) => {
		window.BASEBOARD = data.serial;
	})
	.catch((err) => { console.error(err); });

si.graphics()
	.then((data) => {
		data.displays.forEach((d) => {
			window.REFRESH_RATE = Math.max(window.REFRESH_RATE, d.currentRefreshRate || 60);
		});
	})
	.catch((err) => { console.error(err); });