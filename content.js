(async () => {
  // *********************************************
  // SENTRY
  // *********************************************

  Sentry.init({
    dsn:
      "https://aaa9f167f7fc4c4fa4a19bc7114c9cfc@o470159.ingest.sentry.io/5500430",
    integrations: [new Sentry.Integrations.BrowserTracing()],
    tracesSampleRate: 1.0,
  });

  /** Capture exceptions manually */
  const withCaptureException = (fn) => (...args) => {
    try {
      return fn(...args);
    } catch (e) {
      Sentry.captureException(e);
      throw e;
    }
  };

  const stringHashDataProp = {
    JS: "clickCensorId",
    DOM: "click-censor-id",
  };
  const targetEl = document.body;

  // *********************************************
  // HIGHLIGHTING
  // *********************************************

  // Used for highlighting words
  const mark = new Mark(targetEl);

  const markOptions = {
    element: "span",
    className: "click-censor__censored",
    iframes: true,
    acrossElements: true,
    separateWordSearch: false,
  };

  /**
   * Remove old markings and create new ones.
   *
   * @param {*} text
   * @param {*} markOpts
   * @param {*} unmarkOpts
   */
  const remark = (text, markOpts = {}, unmarkOpts = {}) => {
    // Remove old markings
    return new Promise((resolve) => {
      mark.unmark({
        ...unmarkOpts,
        done: () => {
          unmarkOpts && unmarkOpts.done && unmarkOpts.done();
          // Mark new selection
          mark.mark(text, markOpts);
          resolve();
        },
      });
    });
  };

  /**
   * Apply styling to HTMLElement to make it censored.
   *
   * Styling is applied directly instead of via stylesheet
   * to avoid conflicts.
   */
  const censorText = (el) => {
    el.style.backgroundColor = "black";
    el.style.color = "black";
    el.style.userSelect = "none";
  };

  // *********************************************
  // WATCH HOVER ON ELEMENTS
  // *********************************************

  // Keep ref of the els that we hover over and that are censored, so we can display
  // custom options when clicked on censored elements.
  const hoveredCensoredEls = new Set();
  const isHoveringCensoredText = (el) => {
    if (!hoveredCensoredEls.size) return false;
    return el ? hoveredCensoredEls.has(el) : true;
  };

  let lastIsHoveringCensoredText = false;
  let currentIsHoveringCensoredText = false;
  const isHoveringCensoredTextChanged = () => {
    lastIsHoveringCensoredText = currentIsHoveringCensoredText;
    currentIsHoveringCensoredText = isHoveringCensoredText();
    const changed =
      currentIsHoveringCensoredText !== lastIsHoveringCensoredText;
    return changed;
  };

  const watchElHover = (el, changeCb) => {
    el.addEventListener("mouseenter", (e) => {
      hoveredCensoredEls.add(el);
      if (isHoveringCensoredTextChanged()) {
        changeCb(currentIsHoveringCensoredText, lastIsHoveringCensoredText);
      }
    });
    el.addEventListener("mouseleave", (e) => {
      hoveredCensoredEls.delete(el);
      if (isHoveringCensoredTextChanged()) {
        changeCb(currentIsHoveringCensoredText, lastIsHoveringCensoredText);
      }
    });
  };

  // *********************************************
  // HASHING
  // *********************************************

  /**
   * Simple string hashing.
   *
   * See https://stackoverflow.com/a/34842797/9788634.
   * See https://stackoverflow.com/a/7616484/9788634.
   */
  const hashCode = (str) =>
    str
      .split("")
      .reduce(
        (prevHash, currVal) =>
          ((prevHash << 5) - prevHash + currVal.charCodeAt(0)) | 0,
        0
      );

  // *********************************************
  // MESSAGING
  // *********************************************

  chrome.runtime.onMessage.addListener(
    // Exceptions in this listener are not automatically covered by Sentry
    withCaptureException((data, options, sendResponse) => {
      if (!data) return;
      if (data.action === "click-censor:censor") {
        const stringHash = hashCode(data.payload);

        return remark(
          data.payload,
          {
            ...markOptions,
            each: (el) => {
              el.dataset[stringHashDataProp.JS] = stringHash;
              censorText(el);
              watchElHover(el, (newState) => {
                chrome.runtime.sendMessage({
                  action: "click-censor:update-target",
                  payload: {
                    isCensored: newState,
                    hashId: newState ? stringHash : null,
                  },
                });
              });
            },
          },
          {
            exclude: [`:not([data-${stringHashDataProp.DOM}="${stringHash}"])`],
          }
        );
      }

      if (data.action === "click-censor:uncensor") {
        mark.unmark({
          exclude: [
            `:not([data-${stringHashDataProp.DOM}="${data.payload.hashId}"])`,
          ],
        });
      }
    })
  );
})();
