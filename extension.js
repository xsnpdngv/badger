// @ts-check
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

function activate(context) {

    /* ----------------------------
     * BADGE DECORATION
     * ---------------------------- */

    const emitter = new vscode.EventEmitter();

    const getStatus = (dir) => {
        // Use withFileTypes to get Dirent objects. This avoids doing fs.statSync on every single file!
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        let hasPass = false;
        
        // Fast check for marker files in current directory
        for (const entry of entries) {
            if (entry.name === '.fail') return 'fail';
            if (entry.name === '.pass') hasPass = true;
        }

        // Recurse into child directories
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const childStatus = getStatus(path.join(dir, entry.name));
                if (childStatus === 'fail') return 'fail';
                if (childStatus === 'pass') hasPass = true;
            }
        }
        return hasPass ? 'pass' : null;
    };


    const provider = {

        onDidChangeFileDecorations: emitter.event,

        provideFileDecoration(uri) {
            try {
                // 1. Do the cheap string/path math FIRST
                const config = vscode.workspace.getConfiguration('badger');
                const watchedRoots = config.get('watchDirectories', ['tests']);
                const wsRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;

                const isInsideWatched = watchedRoots.some(root => {
                    const absoluteWatchPath = path.join(wsRoot, root);
                    const relative = path.relative(absoluteWatchPath, uri.fsPath);
                    return uri.fsPath === absoluteWatchPath || (relative && !relative.startsWith('..') && !path.isAbsolute(relative));
                });

                // If not in our watch paths, bail out immediately
                if (!isInsideWatched) return;

                // 2. Do the expensive disk check LAST, only when necessary
                const stat = fs.statSync(uri.fsPath);
                if ( ! stat.isDirectory()) {
                    return;
                }

                const status = getStatus(uri.fsPath);

                if (status === 'fail') {
                    return {
                        badge: '×',
                        tooltip: 'FAIL',
                        color: new vscode.ThemeColor('testing.iconFailed')
                    };
                }

                if (status === 'pass') {
                    return {
                        badge: '+',
                        tooltip: 'PASS'
                    };
                }
            } catch { /* ignore */ }
        }
    };

    function refreshParents(uri) {
        if (!uri) return;
        
        let currentPath = path.dirname(uri.fsPath);
        const urisToRefresh = [];

        // Traverse up the directory tree to invalidate VS Code's cache for all ancestors
        while (true) {
            urisToRefresh.push(vscode.Uri.file(currentPath));
            const nextPath = path.dirname(currentPath);
            
            if (nextPath === currentPath) {
                break; // Hit the file system root
            }
            currentPath = nextPath;
        }

        // Target exactly the folders that need updating, avoiding a heavy global refresh
        emitter.fire(urisToRefresh);
    }

    function refreshStatusBarColor() {
        // Only run if the status bar has an active folder linked to it
        if (statusBarItem.command && statusBarItem.command.arguments && statusBarItem.command.arguments[0]) {
            const currentFolderUri = statusBarItem.command.arguments[0];
            try {
                if (fs.existsSync(currentFolderUri.fsPath)) {
                    const status = getStatus(currentFolderUri.fsPath);
                    statusBarItem.color = status === 'fail' 
                        ? new vscode.ThemeColor('testing.iconFailed') 
                        : undefined;
                }
            } catch { /* ignore */ }
        }
    }

    const markerWatcher = vscode.workspace.createFileSystemWatcher('**/{.pass,.fail}');

    // Fire both the Explorer update and the Status Bar update
    const onMarkerChange = (uri) => {
        refreshParents(uri);
        refreshStatusBarColor(); 
    };

    markerWatcher.onDidCreate(onMarkerChange);
    markerWatcher.onDidDelete(onMarkerChange);
    markerWatcher.onDidChange(onMarkerChange);


    /* ------------------------------------
     * TEST FOLDER CREATION NOTIFIER
     * ------------------------------------ */

    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.tooltip = 'Click to open folder';

    function hideNotification() {
        statusBarItem.hide();
    }

    /**
     * Command triggered by clicking the status bar
     */
    async function openLastCreatedFolder(folderUri) {
        await vscode.commands.executeCommand('workbench.view.explorer');
        await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
        await vscode.commands.executeCommand('revealInExplorer', folderUri);
        await vscode.commands.executeCommand('list.expand');
    }

    // Register command once
    const openFolderCommand = vscode.commands.registerCommand('badger.openLastTestFolder', openLastCreatedFolder);

    /**
     * Extracts the top-level test folder URI if the given URI is inside a watched root.
     */
    function getTopLevelWatchedFolder(uri) {
        if (!vscode.workspace.workspaceFolders) return null;

        const config = vscode.workspace.getConfiguration('badger');
        const watchedRoots = config.get('watchDirectories', ['tests']);
        const wsRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;

        for (const root of watchedRoots) {
            const absoluteWatchPath = path.join(wsRoot, root);
            const relative = path.relative(absoluteWatchPath, uri.fsPath);

            // Check if inside watch directory (not empty, no '..', not absolute)
            if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
                // Split the relative path and grab only the first-level folder name
                const topLevelFolderName = relative.split(path.sep)[0];
                return vscode.Uri.file(path.join(absoluteWatchPath, topLevelFolderName));
            }
        }
        return null;
    }

    /**
     * Validates if the base watch directories still exist.
     */
    function validateWatchEnvironment() {
        if ( ! vscode.workspace.workspaceFolders) {
            hideNotification();
            return;
        }

        const config = vscode.workspace.getConfiguration('badger');
        const watchedRoots = config.get('watchDirectories', ['tests']);
        const wsRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;

        const anyRootExists = watchedRoots.some(root => fs.existsSync(path.join(wsRoot, root)));
        if ( ! anyRootExists) {
            hideNotification();
        }
    }

    const checkAndNotify = (uri) => {
        try {
            const topLevelUri = getTopLevelWatchedFolder(uri);

            // If a valid top-level folder is resolved, update the status bar
            if (topLevelUri && fs.existsSync(topLevelUri.fsPath)) {
                const stat = fs.statSync(topLevelUri.fsPath);
                if (stat.isDirectory()) {
                    const label = path.relative(vscode.workspace.workspaceFolders[0].uri.fsPath, topLevelUri.fsPath);
                    
                    statusBarItem.text = `$(link) ${label}`;
                    statusBarItem.command = {
                        command: 'badger.openLastTestFolder',
                        title: 'Open test folder',
                        arguments: [topLevelUri]
                    };
                    
                    refreshStatusBarColor(); // Set color before showing
                    statusBarItem.show();
                }
            }
        } catch { /* ignore */ }
    };

    function setupFolderWatcher() {
        if ( ! vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
            return;
        }

        const folderWatcher =
            vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(vscode.workspace.workspaceFolders[0], '**/*')
            );

        folderWatcher.onDidCreate(uri => {
            checkAndNotify(uri);
        });

        folderWatcher.onDidDelete(uri => {
            if (statusBarItem.command && statusBarItem.command.arguments[0].fsPath === uri.fsPath) {
                hideNotification();
            }
            validateWatchEnvironment();
        });

        context.subscriptions.push(folderWatcher);
    }

    // Initial call
    setupFolderWatcher();

    /* ------------------------------------
     * PERIODIC CHECK (Self-Healing)
     * ------------------------------------ */

    const periodicCheck = () => {
        if (!vscode.workspace.workspaceFolders) return;

        const config = vscode.workspace.getConfiguration('badger');
        const watchedRoots = config.get('watchDirectories', ['tests']);
        const wsRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;

        let newestFolder = null;
        let maxTime = 0;

        watchedRoots.forEach(root => {
            const absolutePath = path.join(wsRoot, root);
            if (fs.existsSync(absolutePath)) {
                try {
                    // Only scan direct children (depth 1)
                    const children = fs.readdirSync(absolutePath, { withFileTypes: true });
                    for (const child of children) {
                        if (child.isDirectory()) {
                            const childPath = path.join(absolutePath, child.name);
                            const stat = fs.statSync(childPath);

                            // Compare timestamps to find the most recently created/modified folder
                            const time = stat.birthtimeMs || stat.mtimeMs;
                            if (time > maxTime) {
                                maxTime = time;
                                newestFolder = vscode.Uri.file(childPath);
                            }
                        }
                    }
                } catch { /* ignore */ }
            }
        });

        if (newestFolder) {
            const label = path.relative(wsRoot, newestFolder.fsPath);
            statusBarItem.text = `$(link) ${label}`;
            statusBarItem.command = {
                command: 'badger.openLastTestFolder',
                title: 'Open test folder',
                arguments: [newestFolder]
            };
            
            refreshStatusBarColor(); // Set color before showing
            statusBarItem.show();
        }
    };

    periodicCheck();

    const interval = setInterval(periodicCheck, 2000);

    // 1. Refresh when the user changes settings (e.g., watchDirectories)
    const configWatcher = vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('badger')) {
            emitter.fire(); // Global refresh
            validateWatchEnvironment();
        }
    });

    // 2. Refresh when workspace folders are added or removed
    const workspaceWatcher = vscode.workspace.onDidChangeWorkspaceFolders(() => {
        emitter.fire(); // Global refresh
        validateWatchEnvironment();
    });

    /* ----------------------------
     * SUBSCRIPTIONS
     * ---------------------------- */

    context.subscriptions.push(
        vscode.window.registerFileDecorationProvider(provider),
        markerWatcher,
        configWatcher,
        workspaceWatcher,
        emitter,
        statusBarItem,
        openFolderCommand,
        new vscode.Disposable(() => clearInterval(interval))
    );
}

function deactivate() {}

module.exports = { activate, deactivate };
