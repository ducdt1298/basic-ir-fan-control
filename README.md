# Basic IR fan control

A remote's buttons, drawn on a Home Assistant dashboard. Each press transmits
exactly one IR code from a [HubIR](https://github.com/ducdt1298/hub-ir) device
file — no more, no less, the way the remote itself does.

<!-- A screenshot belongs here once the card is on a real dashboard. -->

## Why this exists

Some IR devices are nothing but stateless buttons. A basic fan's remote has one
`SPEED` key that cycles 1→2→3→1, one `OFF/ON` key that toggles, and no way at
all to ask which speed the fan landed on. Modelling that as a `fan` entity means
an entity that guesses, and it guesses wrong the moment somebody picks up the
physical remote — after which every "set speed to 3" lands somewhere else.

This card takes the other option. It shows the keys that are on the remote, and
pressing one sends that key's code. Home Assistant claims to know nothing,
because it knows nothing.

**It deliberately reads no entity state.** There is no state behind these
buttons. That is a design decision, not a missing feature.

## Requirements

[HubIR](https://github.com/ducdt1298/hub-ir) **3.9.0 or newer**, for the
`hub_ir.send_device_command` service the card calls.

The service is registered when the integration loads, which happens as soon as
anything uses it — a HubIR config entry, or a `platform: hub_ir` in YAML. If you
have no HubIR entities at all, add a bare line to `configuration.yaml` so it
loads anyway:

```yaml
hub_ir:
```

## Installation

### HACS

1. **HACS → ⋮ → Custom repositories**
2. Repository `ducdt1298/basic-ir-fan-control`, type **Dashboard**
3. Install, then reload the browser.

HACS registers the Lovelace resource for you.

### Manually

Copy `dist/basic-ir-fan-control.js` into `<config>/www/`, then
**Settings → Dashboards → ⋮ → Resources → Add resource**:

| | |
| --- | --- |
| URL | `/local/basic-ir-fan-control.js?v=1` |
| Type | JavaScript module |

`/local/` is cached hard, so raise the `?v=` every time you replace the file.
The card prints its version to the browser console at startup, which is the
quickest way to tell whether the file you are looking at is the file that
loaded.

## Recording the device

The codes come from the HubIR learning panel, not from this card.

1. **HubIR** in the sidebar → device type **Switch or socket**. That platform
   asks for the least, and it is only the directory the file is written to — no
   entity has to exist, and this card does not create one.
2. Turn on **Toggle (a remote with one power button)** if the remote has a
   single `OFF/ON` key.
3. Name the rest of the keys under **Other buttons**, one per key:
   `speed`, `oscil`, `rhythm`, `timer`.
4. Capture. **Skip** any cell the remote has no key for — a remote with one
   `OFF/ON` key has no separate `on` and `off` to record.
5. Save, and note the device code. The panel offers to create an entity at the
   end; for this card you do not need one.

The paths the panel wrote are the `command` values below: a top-level key is its
own name (`toggle`), and everything under **Other buttons** is `extras/<name>`.

## Configuration

```yaml
type: custom:basic-ir-fan-control
name: Panasonic fan
platform: switch
device_code: 90000
remote_entity_id: remote.bedroom_remote
columns: 3
buttons:
  - name: OFF/ON
    command: toggle
    icon: mdi:power
    icon_color: "#f0c419"
  - { name: SPEED,  command: extras/speed,  icon: mdi:fan-chevron-up }
  - { name: OSCIL., command: extras/oscil,  icon: mdi:arrow-oscillating }
  - { name: RHYTHM, command: extras/rhythm, icon: mdi:weather-windy }
  - { name: TIMER,  command: extras/timer,  icon: mdi:timer-outline }
```

### Card options

| Option | Required | Default | Description |
| ------ | :------: | :-----: | ----------- |
| `type` | yes | | `custom:basic-ir-fan-control` |
| `device_code` | yes | | The device code the HubIR panel saved (90000 and up) |
| `remote_entity_id` | yes | | The Broadlink remote to transmit through |
| `buttons` | yes | | The keys to draw, in order |
| `platform` | no | `switch` | Which `codes/` directory the device file is in |
| `name` | no | | Card heading; omitted entirely when unset |
| `columns` | no | 3 | Buttons per row, 1 to 6 |

### Button options

| Option | Required | Default | Description |
| ------ | :------: | :-----: | ----------- |
| `command` | yes | | Path to the code, e.g. `toggle` or `extras/speed` |
| `name` | no\* | | The label, ideally what the key says on the remote |
| `icon` | no\* | | Any `mdi:` icon |
| `icon_color` | no | | Colour of the icon alone, e.g. the remote's yellow on the power key |
| `accent` | no | `false` | Fill the button, for the one key that matters most |
| `color` | no | | Background for an accent button |
| `text_color` | no | | Foreground to go with `color` |
| `repeat` | no | 1 | Transmit the code this many times (1–100) |
| `delay` | no | 0.4 | Seconds between repeats |

\* A button needs at least one of `name` or `icon`.

`repeat` is worth knowing about for exactly this class of device: on a remote
whose only speed control cycles, `repeat: 2` on a `SPEED` button moves two
speeds in one press. It still cannot know where it started.

### Choosing icons

Pick the icon for the *action*, not the appliance. `mdi:fan` on a SPEED key
says "this is a fan", which the person pressing it already knows;
`mdi:fan-chevron-up` says "this steps the speed up", which is the thing the key
actually does. Likewise `mdi:arrow-oscillating` draws the sweep a fan head
makes, and `mdi:weather-windy` reads as the rising and falling breeze that
rhythm mode produces.

Any [Material Design Icon](https://pictogrammers.com/library/mdi/) works. An
icon name that does not exist renders as an empty space, not an error, so check
the button after changing one.

### A note on colours

To make one key easy to find, prefer `icon_color` to `accent`. The card cannot
know whether the fan is running, and a filled power key looks like "on" whether
it is or not; a coloured icon on an ordinary key only marks where to press.

`icon_color`, `color` and `text_color` take any CSS colour. Hex works, but prefer a keyword or
a full six-digit hex when writing documentation: HACS's own README renderer
turns a short `#nnn` hex into a link to the issue of that number, even inside a
code block.

## Troubleshooting

| What you see | What it means |
| ------------ | ------------- |
| *Custom element doesn't exist* | The resource is not registered, or the browser is holding an old cache. Hard-reload, and check the console banner. |
| *has no code recorded at …* | The `command` path is not in the device file. The message lists the paths that are — use one of those. |
| *Could not read the device file …* | Wrong `platform` or `device_code`. They are the directory and filename: `codes/<platform>/<device_code>.json`. |
| *The remote entity … is unavailable* | The Broadlink is off or off the network. |
| Nothing happens, no error | The code was transmitted and the device did not act on it. Point the Broadlink at the device, and re-record that key. |

## Licence

MIT. The codes, the device files and the learning panel belong to
[HubIR](https://github.com/ducdt1298/hub-ir); this repository is only the card.
