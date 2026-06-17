(function () {
  "use strict";

  // Example dashboard plugin — minimal registration for test suite.
  // No visual component needed; exists so plugin loading doesn't 404.

  var SDK = window.__HERMES_PLUGIN_SDK__;
  if (!SDK) return;

  var React = SDK.React;
  var h = React.createElement;

  function ExamplePlaceholder() {
    return h("div", { style: { padding: "2rem", textAlign: "center", color: "#888" } },
      h("p", null, "Example Plugin — no UI content")
    );
  }

  if (window.__HERMES_PLUGINS__ && typeof window.__HERMES_PLUGINS__.register === "function") {
    window.__HERMES_PLUGINS__.register("example", ExamplePlaceholder);
  }
})();
