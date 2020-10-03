// *********************************************
// COMMAND QUEUE - Queue browser API commands
// *********************************************

const commandQueue = [];
const commandQueueCommands = new Map();
let commandQueueInProgress = false;
let commandQueueDone = Promise.resolve();

const commandQueueFlush = async () => {
  while (commandQueue.length) {
    const [{ command, args }] = commandQueue.splice(0, 1);

    if (!commandQueueCommands.has(command)) {
      throw Error(`[command-queue] Unknown command "${command}"`);
    }

    await commandQueueCommands.get(command)(args);
  }
};

const commandQueueRun = () => {
  if (commandQueueInProgress) return commandQueueDone;

  commandQueueInProgress = true;
  commandQueueDone = commandQueueFlush();
  commandQueueDone.then(() => {
    commandQueueInProgress = false;
  });
  return commandQueueDone;
};

const addToCommandQueue = (cmd) => {
  // If the new command is just a reverse of another command that's already in the queue,
  // remove both of them.
  const revCmd = [...commandQueue]
    .reverse()
    .find(({ to, from, reversable, command }) => {
      return (
        reversable &&
        cmd.reversable &&
        cmd.command === command &&
        cmd.from === to &&
        cmd.to === from
      );
    });
  if (revCmd) {
    commandQueue.splice(commandQueue.indexOf(revCmd), 1);
    return;
  }

  commandQueue.push(cmd);

  return commandQueueRun();
};

// *********************************************
// CONTEXT MENU - Set up context menu items
// *********************************************

chrome.contextMenus.create({
  id: "click-censor:censor",
  title: "Hide Selected Text",
  contexts: ["selection"],
  visible: true,
});

chrome.contextMenus.create({
  id: "click-censor:uncensor",
  title: "Unhide Selected Text",
  // Censored text is not selectable
  contexts: ["page"],
  visible: false,
});

const setToggleContextMenuItemCommand = (menuItemId) => {
  const commandId = `context-menu-item:toggle:${menuItemId}`;
  commandQueueCommands.set(
    commandId,
    (visible) =>
      new Promise((res) =>
        chrome.contextMenus.update(menuItemId, { visible }, res)
      )
  );
  return commandId;
};

const toggleCensorCommand = setToggleContextMenuItemCommand(
  "click-censor:censor"
);
const toggleUncensorCommand = setToggleContextMenuItemCommand(
  "click-censor:uncensor"
);

let lastContextMenuTargetIsCensored = false;

const updateContextMenuTarget = (isCensored) => {
  if (isCensored === lastContextMenuTargetIsCensored) return;
  lastContextMenuTargetIsCensored = isCensored;

  // Toggle between uncensor and censor context menu item based on whether we
  // clicked on censored element.
  addToCommandQueue({
    command: toggleCensorCommand,
    reversable: true,
    to: !isCensored,
    from: isCensored,
    args: !isCensored,
  });
  addToCommandQueue({
    command: toggleUncensorCommand,
    reversable: true,
    to: isCensored,
    from: !isCensored,
    args: isCensored,
  });
};

// *********************************************
// MESSAGING
// *********************************************

const sendMessageToTabs = (message, callback) => (tabs) => {
  tabs.forEach((tab) => {
    chrome.tabs.sendMessage(
      tab.id,
      message,
      // Note: Chrome uses callback pattern while firefox has promise
      callback
    );
  });
};

let targetHashId = null;

chrome.runtime.onMessage.addListener((info, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;

  if (info.action === "click-censor:update-target") {
    updateContextMenuTarget(info.payload.isCensored);
    targetHashId = info.payload.isCensored
      ? info.payload.hashId
      : null;
    return;
  }
});

chrome.contextMenus.onClicked.addListener((info, tabCtx) => {
  if (info.menuItemId === "click-censor:censor") {
    chrome.tabs.query(
      {
        currentWindow: true,
        active: true,
        // Note: Chrome uses callback pattern while firefox has promise
      },
      sendMessageToTabs({
        action: "click-censor:censor",
        payload: info.selectionText,
      })
    );
    return;
  }

  if (info.menuItemId === "click-censor:uncensor") {
    chrome.tabs.query(
      {
        currentWindow: true,
        active: true,
        // Note: Chrome uses callback pattern while firefox has promise
      },
      sendMessageToTabs({
        action: "click-censor:uncensor",
        payload: {
          hashId: targetHashId,
        },
      }),
    );
    return;
  }
});
