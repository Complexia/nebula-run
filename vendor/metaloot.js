/*!
 * Metaloot SDK v1 — drop-in platform client for browser games.
 *
 * Usage:
 *   <script src="metaloot.js"></script>  (vendored copy, or hotlink from the platform /sdk/metaloot.js)
 *   const session = await Metaloot.ready;            // { user, game, totalSeconds } or { user: null }
 *   await Metaloot.saves.put('main', { level: 3 });  // cloud save
 *   const save = await Metaloot.saves.get('main');   // { data, updatedAt } (data null if empty)
 *   await Metaloot.items.grant({ key: 'gold', kind: 'currency', quantity: 25 });
 *   await Metaloot.characters.upsert({ key: 'hero', name: 'Hero', class: 'Knight', level: 4 });
 *
 * Auth is automatic: when a player launches the game from Metaloot, a scoped
 * token arrives in the URL fragment (#mlt=...). The SDK stores it, strips the
 * fragment, verifies it against the platform, and sends playtime heartbeats
 * while the tab is visible. Without a token the game runs in guest mode
 * (every API call resolves to null / no-ops) — the game stays fully playable.
 */
(function () {
  "use strict";

  var TOKEN_KEY = "metaloot.token.v1";
  var HEARTBEAT_MS = 60 * 1000;

  var config = { platform: null, game: null };
  var token = null;
  var claims = null;
  var session = { user: null, game: null, totalSeconds: 0 };
  var heartbeatTimer = null;

  function decodeClaims(jwt) {
    try {
      var payload = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      return JSON.parse(decodeURIComponent(escape(atob(payload))));
    } catch (err) {
      return null;
    }
  }

  function isUsable(decoded) {
    return decoded && decoded.api && decoded.slug && (!decoded.exp || decoded.exp * 1000 > Date.now() + 30000);
  }

  // 1. Pick up a fresh token from the launch fragment, else fall back to storage.
  function loadToken() {
    var match = /[#&]mlt=([^&]+)/.exec(window.location.hash || "");
    if (match) {
      var fresh = match[1];
      var decoded = decodeClaims(fresh);
      if (isUsable(decoded)) {
        token = fresh;
        claims = decoded;
        try {
          localStorage.setItem(TOKEN_KEY, fresh);
        } catch (err) {
          /* storage unavailable — session-only auth */
        }
      }
      var cleaned = (window.location.hash || "").replace(/[#&]mlt=[^&]+/, "");
      try {
        history.replaceState(null, "", window.location.pathname + window.location.search + (cleaned === "#" ? "" : cleaned));
      } catch (err) {
        /* ignore */
      }
    }

    if (!token) {
      try {
        var stored = localStorage.getItem(TOKEN_KEY);
        var storedClaims = stored ? decodeClaims(stored) : null;
        if (isUsable(storedClaims)) {
          token = stored;
          claims = storedClaims;
        }
      } catch (err) {
        /* ignore */
      }
    }
  }

  function clearToken() {
    token = null;
    claims = null;
    session = { user: null, game: null, totalSeconds: 0 };
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch (err) {
      /* ignore */
    }
  }

  function api(path, options) {
    if (!token || !claims) {
      return Promise.resolve(null);
    }
    options = options || {};
    var headers = { Authorization: "Bearer " + token };
    if (options.body) {
      headers["Content-Type"] = "application/json";
    }
    return fetch(claims.api + "/api/v1/game" + path, {
      method: options.method || "GET",
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    }).then(function (response) {
      if (response.status === 401) {
        clearToken();
        stopHeartbeat();
        return null;
      }
      if (!response.ok) {
        return response.json().then(
          function (err) {
            throw new Error("Metaloot API error " + response.status + ": " + (err && err.message ? err.message : response.status));
          },
          function () {
            throw new Error("Metaloot API error " + response.status);
          },
        );
      }
      return response.json();
    });
  }

  function beat() {
    if (document.visibilityState !== "visible") {
      return;
    }
    api("/playtime", { method: "POST" })
      .then(function (result) {
        if (result && typeof result.totalSeconds === "number") {
          session.totalSeconds = result.totalSeconds;
        }
      })
      .catch(function () {
        /* transient network errors are fine; next beat retries */
      });
  }

  function startHeartbeat() {
    if (heartbeatTimer) {
      return;
    }
    beat();
    heartbeatTimer = setInterval(beat, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible" && heartbeatTimer) {
        beat();
      }
    });
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  loadToken();

  var ready = (function () {
    if (!token) {
      return Promise.resolve(session);
    }
    return api("/me")
      .then(function (me) {
        if (me && me.user) {
          session = { user: me.user, game: me.game, totalSeconds: me.totalSeconds || 0 };
          startHeartbeat();
        }
        return session;
      })
      .catch(function () {
        // Platform unreachable — trust the signed token for display, retry later beats.
        if (claims) {
          session = {
            user: { id: claims.sub, username: claims.username, name: claims.name || null, avatar: claims.avatar || null },
            game: claims.slug,
            totalSeconds: 0,
          };
          startHeartbeat();
        }
        return session;
      });
  })();

  window.Metaloot = {
    /** Resolves once auth has settled: { user, game, totalSeconds }; user is null in guest mode. */
    ready: ready,

    /** Optional. Lets a vendored SDK know the platform origin for guest-mode sign-in links. */
    init: function (options) {
      options = options || {};
      if (options.platform) config.platform = String(options.platform).replace(/\/$/, "");
      if (options.game) config.game = options.game;
      return ready;
    },

    get user() {
      return session.user;
    },

    get signedIn() {
      return Boolean(session.user);
    },

    get totalSeconds() {
      return session.totalSeconds;
    },

    /** Where to send a guest to sign in and relaunch with a session. */
    get loginUrl() {
      var origin = (claims && claims.api) || config.platform;
      var slug = (claims && claims.slug) || config.game;
      if (!origin) return null;
      return slug ? origin + "/game/" + slug : origin;
    },

    saves: {
      get: function (slot) {
        return api("/saves/" + encodeURIComponent(slot || "main"));
      },
      put: function (slot, data) {
        return api("/saves/" + encodeURIComponent(slot || "main"), { method: "PUT", body: data });
      },
      remove: function (slot) {
        return api("/saves/" + encodeURIComponent(slot || "main"), { method: "DELETE" });
      },
    },

    items: {
      /** grant({ key, name, kind: 'item'|'artifact'|'currency', icon, rarity, description, quantity, mode: 'increment'|'set' }) */
      grant: function (item) {
        return api("/items", { method: "POST", body: item });
      },
      list: function () {
        return api("/items");
      },
    },

    characters: {
      /** upsert({ key, name, class, level, stats }) */
      upsert: function (character) {
        return api("/characters", { method: "POST", body: character });
      },
      list: function () {
        return api("/characters");
      },
    },

    /** Forget the local session (player stays signed in on the platform). */
    logout: function () {
      clearToken();
      stopHeartbeat();
    },
  };
})();
