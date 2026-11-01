/**
 * Basic IR fan control — a remote's buttons, drawn on a dashboard.
 *
 * Some IR devices are nothing but stateless buttons. A basic fan's remote has
 * one SPEED key that cycles 1-2-3-1 and no way to ask which speed it landed on,
 * so an entity for it would have to guess, and a guess that is wrong is worse
 * than no entity at all. This card takes the other option: draw the buttons and
 * transmit exactly one code per press, the way the remote itself does.
 *
 * Every button calls hub_ir.send_device_command, which names a code inside a
 * device file recorded by the HubIR panel. That service needs no entity and is
 * not administrator-only, so the card works for everyone in the house — the
 * panel's own websocket commands are admin-only and would not.
 *
 * Plain DOM by design: no build step, no bundler, and nothing fetched from
 * outside, which Home Assistant's content security policy would block. Colours
 * come from Home Assistant's own CSS custom properties, so the card follows the
 * active theme.
 */

const VERSION = "1.1.0";

const CARD_TYPE = "basic-ir-fan-control";
const DOMAIN = "hub_ir";
const SERVICE = "send_device_command";

// Which codes/<platform>/ directory the device file sits in. A remote that is
// only buttons is recorded as a switch, because that platform asks for the
// least: on, off, toggle and whatever free-form buttons were named.
const DEFAULT_PLATFORM = "switch";

const PLATFORMS = ["climate", "fan", "light", "media_player", "switch"];

const DEFAULT_COLUMNS = 3;
const MAX_COLUMNS = 6;

// How long a pressed button stays lit. Long enough to see on a phone, short
// enough not to lag behind someone tapping SPEED three times in a row.
const FLASH_MS = 180;

const STYLES = `
  :host { display: block; }

  ha-card {
    padding: 16px;
    box-sizing: border-box;
  }

  .title {
    font-size: var(--ha-card-header-font-size, 1.5rem);
    font-weight: normal;
    color: var(--ha-card-header-color, var(--primary-text-color));
    margin: 0 0 12px;
    line-height: 1.2;
  }

  .pad {
    display: grid;
    gap: 8px;
  }

  button {
    font: inherit;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-height: 72px;
    padding: 10px 6px;
    border-radius: 12px;
    cursor: pointer;
    border: 1px solid var(--divider-color, #ccc);
    background: var(--card-background-color, #fff);
    color: var(--primary-text-color);
    transition: transform 90ms ease, filter 90ms ease;
    /* Larger than Home Assistant's 24px default. These are the keys of a
       remote, aimed at with a thumb from across the room, so the glyph is what
       carries the button and the label underneath only confirms it. */
    --mdc-icon-size: 30px;
  }

  /* A button with no label gives its icon the whole key. */
  button:not(:has(.label)) {
    --mdc-icon-size: 34px;
  }

  /* The label is what the key says on the remote, so it is never abbreviated
     away; long ones wrap rather than being clipped.

     break-word rather than anywhere: the latter also shrinks the label's
     min-content width, which lets the grid squeeze a column narrower than the
     word itself and turns SPEED into three stacked letters. */
  .label {
    font-size: 0.8rem;
    line-height: 1.15;
    text-align: center;
    overflow-wrap: break-word;
  }

  button.accent {
    background: var(--btn-color, var(--primary-color));
    color: var(--btn-text-color, var(--text-primary-color, #fff));
    border-color: transparent;
  }

  /* A tinted glyph on an ordinary key. For a stateless device a filled key
     reads as "this is on" and is wrong half the time; a coloured icon only
     says "this is the one to look for". */
  ha-icon {
    color: var(--btn-icon-color, inherit);
  }

  button.flash {
    transform: scale(0.96);
    filter: brightness(1.25);
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  button:focus-visible {
    outline: 2px solid var(--primary-color);
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    button { transition: none; }
    button.flash { transform: none; }
  }

  .error {
    margin-top: 12px;
    padding: 8px 10px;
    border-radius: 8px;
    font-size: 0.85rem;
    line-height: 1.35;
    color: var(--error-color, #db4437);
    background: var(--secondary-background-color, rgba(0, 0, 0, 0.05));
  }
`;

/** Escape a value for interpolation into markup. */
function esc(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[character]
  );
}

/**
 * Turn a rejected service call into a message.
 *
 * Home Assistant wraps the integration's own text, and that text is written to
 * be acted on — an unresolved path lists the paths the device file does offer —
 * so it is shown as it arrives rather than replaced with something vaguer.
 */
function describe(err) {
  if (!err) return "The command could not be sent.";
  return err.message || err.error?.message || String(err);
}

class BasicIrFanControl extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = null;
    this._hass = null;
    this._error = "";
    // Index of the button waiting on a service call, or null. One at a time:
    // two codes transmitted at once through the same Broadlink is one code the
    // device never sees.
    this._busy = null;
  }

  /**
   * Validate the card's configuration.
   *
   * Throwing here is what makes Home Assistant show its own error card. A pad
   * that renders but cannot transmit looks like a broken fan rather than a
   * broken configuration, which is a much longer afternoon.
   */
  setConfig(config) {
    if (!config || typeof config !== "object") {
      throw new Error("Configuration is missing.");
    }

    const platform = config.platform ?? DEFAULT_PLATFORM;
    if (!PLATFORMS.includes(platform)) {
      throw new Error(
        `platform must be one of ${PLATFORMS.join(", ")} — it is the codes ` +
          `directory the device file is in, not the kind of entity you want.`
      );
    }

    if (!Number.isInteger(config.device_code) || config.device_code < 0) {
      throw new Error(
        "device_code is required, and is the number the HubIR panel showed " +
          "when it saved the device file (90000 and up)."
      );
    }

    const remote = config.remote_entity_id;
    if (typeof remote !== "string" || !remote.startsWith("remote.")) {
      throw new Error(
        "remote_entity_id is required and must be a Broadlink remote, for " +
          "example remote.bedroom_remote."
      );
    }

    if (!Array.isArray(config.buttons) || config.buttons.length === 0) {
      throw new Error("buttons is required and must list at least one button.");
    }

    config.buttons.forEach((button, index) => {
      if (!button || typeof button.command !== "string" || !button.command) {
        throw new Error(
          `buttons[${index}] needs a command: the path to the code inside the ` +
            `device file, such as toggle or extras/speed.`
        );
      }
      if (!button.name && !button.icon) {
        throw new Error(
          `buttons[${index}] needs a name or an icon, or there is nothing to press.`
        );
      }
    });

    this._config = {
      ...config,
      platform,
      columns: Math.min(
        Math.max(parseInt(config.columns, 10) || DEFAULT_COLUMNS, 1),
        MAX_COLUMNS
      ),
    };
    this._error = "";
    this._busy = null;
    this._render();
  }

  /**
   * Take Home Assistant's state object.
   *
   * Stored only so a press has something to call a service on. The card reads
   * no entity: there is no state behind these buttons to read, which is the
   * whole reason it exists.
   */
  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._render();
  }

  getCardSize() {
    if (!this._config) return 3;
    const rows = Math.ceil(this._config.buttons.length / this._config.columns);
    return (this._config.name ? 1 : 0) + rows;
  }

  /** Sizing for a sections view, where cards are placed on a 12-column grid. */
  getGridOptions() {
    return { columns: 12, rows: "auto", min_columns: 6 };
  }

  static getStubConfig() {
    return {
      type: `custom:${CARD_TYPE}`,
      platform: DEFAULT_PLATFORM,
      device_code: 90000,
      remote_entity_id: "",
      buttons: [{ name: "OFF/ON", command: "toggle", accent: true }],
    };
  }

  _render() {
    if (!this._config) return;

    const { name, columns, buttons } = this._config;

    this.shadowRoot.innerHTML = `<style>${STYLES}</style>
      <ha-card>
        ${name ? `<h1 class="title">${esc(name)}</h1>` : ""}
        <div class="pad" style="grid-template-columns: repeat(${columns}, 1fr);">
          ${buttons.map((button, index) => this._button(button, index)).join("")}
        </div>
        ${this._error ? `<div class="error" role="alert">${esc(this._error)}</div>` : ""}
      </ha-card>`;

    this._bind();
  }

  _button(button, index) {
    // A real <button>, so it is reachable by keyboard and announced as a
    // button, and Enter and Space come for free.
    const classes = ["key"];
    if (button.accent) classes.push("accent");
    if (this._busy === index) classes.push("flash");

    // Only ever the user's own configuration, and escaped, but it lands in a
    // style attribute so it is worth saying out loud.
    const colour = button.color
      ? ` --btn-color: ${esc(button.color)};`
      : "";
    const text = button.text_color
      ? ` --btn-text-color: ${esc(button.text_color)};`
      : "";
    const icon = button.icon_color
      ? ` --btn-icon-color: ${esc(button.icon_color)};`
      : "";

    return `<button class="${classes.join(" ")}" data-index="${index}"
      style="${colour}${text}${icon}" ${this._busy !== null ? "disabled" : ""}
      title="${esc(button.command)}">
      ${button.icon ? `<ha-icon icon="${esc(button.icon)}"></ha-icon>` : ""}
      ${button.name ? `<span class="label">${esc(button.name)}</span>` : ""}
    </button>`;
  }

  _bind() {
    this.shadowRoot.querySelectorAll("button[data-index]").forEach((node) => {
      node.addEventListener("click", () =>
        this._press(Number(node.dataset.index))
      );
    });
  }

  async _press(index) {
    const button = this._config.buttons[index];
    if (!button || this._busy !== null) return;

    if (!this._hass) {
      this._error = "Home Assistant is not connected yet.";
      this._render();
      return;
    }

    this._busy = index;
    this._error = "";
    this._render();

    const started = Date.now();
    try {
      await this._hass.callService(DOMAIN, SERVICE, {
        platform: this._config.platform,
        device_code: this._config.device_code,
        command: button.command,
        remote_entity_id: this._config.remote_entity_id,
        ...(button.repeat ? { repeat: button.repeat } : {}),
        ...(button.delay !== undefined ? { delay: button.delay } : {}),
      });
    } catch (err) {
      this._error = describe(err);
    }

    // A Broadlink answers in well under FLASH_MS on a good day, and a press
    // that lights up for two frames does not read as a press at all.
    const remaining = FLASH_MS - (Date.now() - started);
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }

    this._busy = null;
    this._render();
  }
}

customElements.define(CARD_TYPE, BasicIrFanControl);

window.customCards = window.customCards || [];
window.customCards.push({
  type: CARD_TYPE,
  name: "Basic IR fan control",
  description:
    "A remote's buttons, drawn on a dashboard. Each press transmits one IR " +
    "code from a HubIR device file. For devices with no state worth guessing.",
  preview: false,
  documentationURL: "https://github.com/ducdt1298/basic-ir-fan-control",
});

// Which version is loaded, because a stale Lovelace resource is cached hard and
// looks exactly like a card that did not get the fix.
console.info(
  `%c BASIC-IR-FAN-CONTROL %c ${VERSION} `,
  "color: #fff; background: #03a9f4; font-weight: 700;",
  "color: #03a9f4; background: #fff; font-weight: 700;"
);
