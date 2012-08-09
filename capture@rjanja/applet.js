/**
 * Cinnamon Desktop Capture applet.
 *
 * @author  Robert Adams <radams@artlogic.com>
 * @link    http://github.com/rjanja/desktop-capture/
 */


const Cinnamon = imports.gi.Cinnamon;
const Applet = imports.ui.applet;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const PopupMenu = imports.ui.popupMenu;
const PopupSliderMenuItem = imports.ui.popupMenu.PopupSliderMenuItem;
const PopupSwitchMenuItem = imports.ui.popupMenu.PopupSwitchMenuItem;
const PopupBaseMenuItem = imports.ui.popupMenu.PopupBaseMenuItem;
const Switch = imports.ui.popupMenu.Switch;
const Clutter = imports.gi.Clutter;
const Lightbox = imports.ui.lightbox;

const Util = imports.misc.util;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Lang = imports.lang;
const St = imports.gi.St;
const Gtk = imports.gi.Gtk;

const Capture = imports.ui.appletManager.applets["capture@rjanja"];
const Screenshot = Capture.screenshot;
const AppletDir = imports.ui.appletManager.appletMeta["capture@rjanja"].path;
const SUPPORT_FILE = AppletDir + '/support.json';

const KEY_SCREENSHOT_SCHEMA = "org.cinnamon.applets.capture@rjanja"
const KEY_INCLUDE_CURSOR = "include-cursor";
const KEY_OPEN_AFTER = "open-after";
const KEY_DELAY_SECONDS = "delay-seconds";
const KEY_CAMERA_PROGRAM = "camera-program";
const KEY_RECORDER_PROGRAM = "recorder-program";

const CAMERA_PROGRAM_GNOME = 'gnome-screenshot';
const KEY_GNOME_SCREENSHOT_SCHEMA = "org.gnome.gnome-screenshot"
const KEY_GNOME_INCLUDE_CURSOR = "include-pointer";
const KEY_GNOME_DELAY_SECONDS = "delay";

const KEY_RECORDER_SCHEMA = "org.cinnamon.recorder";
const KEY_RECORDER_FRAMERATE = "framerate";
const KEY_RECORDER_FILE_EXTENSION = "file-extension";
const KEY_RECORDER_PIPELINE = "pipeline";


function ConfirmDialog(){
   this._init();
}

function StubbornSliderMenuItem() {
    this._init.apply(this, arguments);
}

StubbornSliderMenuItem.prototype = {
    __proto__: PopupSliderMenuItem.prototype,

    _init: function(value) {
        PopupBaseMenuItem.prototype._init.call(this, { activate: false });

        this.actor.connect('key-press-event', Lang.bind(this, this._onKeyPressEvent));

        if (isNaN(value))
            // Avoid spreading NaNs around
            throw TypeError('The slider value must be a number');
        this._value = Math.max(Math.min(value, 1), 0);

        this._slider = new St.DrawingArea({ style_class: 'popup-slider-menu-item' });
        this.addActor(this._slider, { expand: true, span: -1 });
        this._slider.connect('repaint', Lang.bind(this, this._sliderRepaint));
        this.actor.connect('button-press-event', Lang.bind(this, this._startDragging));
        this.actor.connect('scroll-event', Lang.bind(this, this._onScrollEvent));

        this._releaseId = this._motionId = 0;
        this._dragging = false;
    },
};

function StubbornSwitchMenuItem() {
    this._init.apply(this, arguments);
}

StubbornSwitchMenuItem.prototype = {
   __proto__: PopupSwitchMenuItem.prototype,

    _init: function(text, active, params) {
        //PopupSwitchMenuItem.prototype._init.call(this, text, active, params);
        PopupBaseMenuItem.prototype._init.call(this, params);

        this.label = new St.Label({ text: text, style_class: 'popup-switch-menu-label' });
        this._switch = new Switch(active);

        this.addActor(this.label);

        this._statusBin = new St.Bin({ style_class: 'popup-switch-menu-bin', x_align: St.Align.END });
        this.addActor(this._statusBin,
                      { expand: false, span: -1 });

        this._statusLabel = new St.Label({ text: '',
                                           style_class: 'popup-inactive-menu-item'
                                         });
        this._statusBin.child = this._switch.actor;
    },

   activate: function(event) {
      if (this._switch.actor.mapped) {
         this.toggle();
      }

      // we allow pressing space to toggle the switch
      // without closing the menu
      if (event.type() == Clutter.EventType.KEY_PRESS &&
         event.get_key_symbol() == Clutter.KEY_space)
         return;

      //PopupBaseMenuItem.prototype.activate.call(this, event);
   },
};

function StubbornComboMenuItem() {
    this._init.apply(this, arguments);
}

StubbornComboMenuItem.prototype = {
   __proto__: PopupBaseMenuItem.prototype,

    _init: function(text, active, onChange) {
         PopupBaseMenuItem.prototype._init.call(this, { reactive: false,
                      style_class: 'delay-chooser' });

         /*this._iconBin = new St.Button({ style_class: 'delay-chooser-user-icon' });
         this.addActor(this._iconBin);

         this._iconBin.connect('clicked', Lang.bind(this,
            function() {
                this.activate();
            }));*/

         this.label = new St.Label({ text: text, style_class: 'delay-chooser-label' });
         this.addActor(this.label);

         this._section = new PopupMenu.PopupMenuSection();
         this.addActor(this._section.actor);

         this._combo = new PopupMenu.PopupComboBoxMenuItem({ style_class: 'popup-combo' });
         this._section.addMenuItem(this._combo);

         let item;

         item = new PopupMenu.PopupMenuItem(_("None"));
         this._combo.addMenuItem(item);

         item = new PopupMenu.PopupMenuItem(_("1 sec"));
         this._combo.addMenuItem(item);

         item = new PopupMenu.PopupMenuItem(_("2 sec"));
         this._combo.addMenuItem(item);

         item = new PopupMenu.PopupMenuItem(_("3 sec"));
         this._combo.addMenuItem(item);

         item = new PopupMenu.PopupMenuItem(_("5 sec"));
         this._combo.addMenuItem(item);

         this._combo.connect('active-item-changed', onChange);

         this._combo.setSensitive(true);
         this._combo.setActiveItem(active);

         return true;
   }
};

function MyAppletPopupMenu(launcher, orientation) {
    this._init(launcher, orientation);
}

MyAppletPopupMenu.prototype = {
    __proto__: Applet.AppletPopupMenu.prototype,

    _init: function(launcher, orientation) {
        PopupMenu.PopupMenu.prototype._init.call(this, launcher.actor, 0.0, orientation, 0);
        Main.uiGroup.add_actor(this.actor);
        this.actor.hide();
    },

    addAction: function(title, callback) {
        let menuItem = new PopupMenu.PopupMenuItem(title, {  });
        this.addMenuItem(menuItem);
        menuItem.connect('activate', Lang.bind(this, function (menuItem, event) {
            callback(event);
        }));

        return menuItem;
    },
}

function MyPopupMenuItem()
{
   this._init.apply(this, arguments);
}

MyPopupMenuItem.prototype =
{
   __proto__: PopupMenu.PopupBaseMenuItem.prototype,
   _init: function(icon, text, params)
   {
      PopupMenu.PopupBaseMenuItem.prototype._init.call(this, params);
      this.icon = icon;
      this.addActor(this.icon);
      this.label = new St.Label({ text: text });
      this.addActor(this.label);
   }
};

function TextImageMenuItem() {
    this._init.apply(this, arguments);
}

TextImageMenuItem.prototype = {
    __proto__: PopupMenu.PopupBaseMenuItem.prototype,

    _init: function(text, icon, image, align, style) {
        PopupMenu.PopupBaseMenuItem.prototype._init.call(this);

        this.actor = new St.BoxLayout({style_class: style});
        this.actor.add_style_pseudo_class('active');
        if (icon) {
            this.icon = new St.Icon({icon_name: icon});
        }
        if (image) {
            this.icon = new St.Bin();
            this.icon.set_child(this._getIconImage(image));
        }
        this.text = new St.Label({text: text});
        if (align === "left") {
            this.actor.add_actor(this.icon, { span: 0 });
            this.actor.add_actor(this.text, { span: -1 });
        }
        else {
            this.actor.add_actor(this.text, { span: 0 });
            this.actor.add_actor(this.icon, { span: -1 });
        }
    },

    setText: function(text) {
        this.text.text = text;
    },

    setIcon: function(icon) {
        this.icon.icon_name = icon;
    },

    setImage: function(image) {
        this.icon.set_child(this._getIconImage(image));
    },

    // retrieve an icon image
    _getIconImage: function(icon_name) {
         let icon_file = icon_path + icon_name + ".svg";
         let file = Gio.file_new_for_path(icon_file);
         let icon_uri = file.get_uri();

         return St.TextureCache.get_default().load_uri_async(icon_uri, 16, 16);
    },
}

function getSettings(schema) {
   if (Gio.Settings.list_schemas().indexOf(schema) == -1)
      throw _("Schema \"%s\" not found.").format(schema);
   return new Gio.Settings({ schema: schema });
}

function MyApplet(orientation) {
   this._init(orientation);
}

MyApplet.prototype = {
   __proto__: Applet.IconApplet.prototype,

   _settingsChanged: function (settings, key) {
        if (this._settings.get_boolean(KEY_INCLUDE_CURSOR)) {
            this._includeCursor = true;
        }
        if (this._settings.get_boolean(KEY_OPEN_AFTER)) {
            this._openAfter = true;
        }

        this._modifiers = {};
        this._delay = this._settings.get_int(KEY_DELAY_SECONDS);

        let oldCamera = this._cameraProgram;
        let oldRecorder = this._recorderProgram;
        this._cameraProgram = this._settings.get_string(KEY_CAMERA_PROGRAM);
        this._recorderProgram = this._settings.get_string(KEY_RECORDER_PROGRAM);

        this._cameraSaveDir = this._settings.get_string('camera-save-dir');
        this._recorderSaveDir = this._settings.get_string('recorder-save-dir');
        this._cameraSavePrefix = this._settings.get_string('camera-save-prefix');
        this._recorderSavePrefix = this._settings.get_string('recorder-save-prefix');
        this._windowAsArea = this._settings.get_boolean('capture-window-as-area');
        this._includeWindowFrame = this._settings.get_boolean('include-window-frame');
        this._useCameraFlash = this._settings.get_boolean('use-camera-flash');
        this._showCaptureTimer = this._settings.get_boolean('show-capture-timer');
        this._playShutterSound = this._settings.get_boolean('play-shutter-sound');
        this._playIntervalSound = this._settings.get_boolean('play-timer-interval-sound');
        this._copyToClipboard = this._settings.get_boolean('copy-to-clipboard');
        this._sendNotification = this._settings.get_boolean('send-notification');
        this._includeStyles = this._settings.get_boolean('include-styles');
        this._modActivatesTimer = this._settings.get_boolean('mod-activates-timer');

        if (this._cameraProgram == 'none')
        {
            this._cameraProgram = null;
        }

        if (this._recorderProgram == 'none')
        {
            this._recorderProgram = null;
        }

        // Were we called due to a settings change, or by init?
        if (settings != null) {
            if (oldCamera != this._cameraProgram || oldRecorder != this._recorderProgram)
            {
                this.draw_menu();
            }
        }
    },

   getModifier: function(symbol) {
      global.log('getModifier ' + symbol);
      return this._modifiers[symbol] || false;
   },

   setModifier: function(symbol, value) {
      global.log('setModifier ' + symbol);
      this._modifiers[symbol] = value;
   },

   _onMenuKeyRelease: function(actor, event) {
      let symbol = event.get_key_symbol();

      if (symbol == Clutter.Shift_L)
      {
         this.setModifier(symbol, false);
      }
   },

    _onMenuKeyPress: function(actor, event) {
      let symbol = event.get_key_symbol();
      
      if (symbol == Clutter.Shift_L)
      {
         this.setModifier(symbol, true);
      }
   },

    _crSettingsChanged: function(settings, key) {
        if (this._recorderProgram == 'cinnamon')
        {
           this.cRecorder = new Cinnamon.Recorder({ stage: global.stage });
        }
        global.cr = this.cRecorder;
        this._crFrameRate = this._crSettings.get_int(KEY_RECORDER_FRAMERATE);
        this._crFileExtension = this._crSettings.get_string(KEY_RECORDER_FILE_EXTENSION);
        this._crPipeline = this._crSettings.get_string(KEY_RECORDER_PIPELINE);
    },

   _init: function(orientation) {
      Applet.IconApplet.prototype._init.call(this, orientation);

      try {
         this._programs = {};
         this._programSupport = {};
         this._includeCursor = false;
         this._openAfter = false;
         this._delay = 0;
         this.orientation = orientation;
         this.cRecorder = null;
         this._crFrameRate = null;
         this._crFileExtension = null;
         this._crPipeline = null;

         // Load up our settings
         this._settings = getSettings(KEY_SCREENSHOT_SCHEMA);
         this._settings.connect('changed', Lang.bind(this, this._settingsChanged));
         this._settingsChanged();

         // GNOME Screenshot settings, we only write cursor option,
         // don't need to read anything from it.
         this._ssSettings = getSettings(KEY_GNOME_SCREENSHOT_SCHEMA);

         // Cinnamon Recorder settings
         this._crSettings = getSettings(KEY_RECORDER_SCHEMA);
         this._crSettings.connect('changed', Lang.bind(this, this._crSettingsChanged));
         this._crSettingsChanged();

         // Get information on what our various programs support
         let supportFile = GLib.build_filenamev([SUPPORT_FILE]);
         try {
            this._programSupport = JSON.parse(Cinnamon.get_file_contents_utf8_sync(supportFile));
         }
         catch (e) {
            global.logError("Could not parse Desktop Capture's support.json!")
            global.logError(e);
         }

         //this.detect_programs();
         let xfixesCursor = Cinnamon.XFixesCursor.get_for_stage(global.stage);
         this._xfixesCursor = xfixesCursor;

         this.set_applet_icon_symbolic_name("camera-photo-symbolic");
         this.set_applet_tooltip(_("Screenshot and desktop video"));

         this.draw_menu(orientation);

         // Add the right-click context menu item. This only needs
         // to be drawn a single time.
         this.settingsItem = new Applet.MenuItem(_("Capture settings"),
           'system-run', Lang.bind(this, this._launch_settings));

         this._applet_context_menu.addMenuItem(this.settingsItem);

      }
      catch (e) {
         global.logError(e);
      }
   },

   /**
    * showSystemCursor:
    * Show the system mouse pointer.
    */
   showSystemCursor: function() {
     this._xfixesCursor.show();
   },

   /**
    * hideSystemCursor:
    * Hide the system mouse pointer.
    */
   hideSystemCursor: function() {
     this._xfixesCursor.hide();
   },

   indent: function(text) {
      if (this.actor.get_direction() == St.TextDirection.RTL) {
         return text + "  ";
      }
      else {
         return "  " + text;
      }
   },

   draw_menu: function(orientation) {
      this.menuManager = new PopupMenu.PopupMenuManager(this);
      this.menu = new MyAppletPopupMenu(this, this.orientation);
      this.menuManager.addMenu(this.menu);

      this._contentSection = new PopupMenu.PopupMenuSection();
      this.menu.addMenuItem(this._contentSection);

      if (this.has_camera()) {
         this._outputTitle = new TextImageMenuItem(_("Camera"), "camera-photo", false, "right", "sound-volume-menu-item");
         this.menu.addMenuItem(this._outputTitle);

         if (this.get_camera_program() == 'cinnamon') {
            this.menu.addAction(this.indent(_("Window")), Lang.bind(this, function(e) {
               return this.run_cinnamon_camera(Screenshot.SelectionType.WINDOW, e);
            }));
            this.menu.addAction(this.indent(_("Area")), Lang.bind(this, function(e) {
               return this.run_cinnamon_camera(Screenshot.SelectionType.AREA, e);
            }));
            this.menu.addAction(this.indent(_("Cinnamon UI")), Lang.bind(this, function(e) {
               return this.run_cinnamon_camera(Screenshot.SelectionType.CINNAMON, e);
            }));
            this.menu.addAction(this.indent(_("Screen")), Lang.bind(this, function(e) {
               return this.run_cinnamon_camera(Screenshot.SelectionType.SCREEN, e);
            }));
         }
         else {

            if (this.has_camera_support('window'))
            {
               this.menu.addAction(this.indent(_("Window")), Lang.bind(this, function(e) {
                  this.Exec(this.get_camera_command('window'));
               }));
            }

            if (this.has_camera_support('window-section'))
            {
               this.menu.addAction(this.indent(_("Window section")), Lang.bind(this, function(e) {
                  this.Exec(this.get_camera_command('window-section'));
               }));
            }

            if (this.has_camera_support('current-window'))
            {
               this.menu.addAction(this.indent(_("Current window")), Lang.bind(this, function(e) {
                  this.Exec(this.get_camera_command('current-window'));
               }));
            }

            if (this.has_camera_support('area'))
            {
               this.menu.addAction(this.indent(_("Area")), Lang.bind(this, function(e) {
                  this.Exec(this.get_camera_command('area'));
               }));
            }

            if (this.has_camera_support('screen'))
            {
               this.menu.addAction(this.indent(_("Entire screen")), Lang.bind(this, function(e) {
                  this.Exec(this.get_camera_command('screen'));
               }));
            }

            if (this.has_camera_support('menu'))
            {
               this.menu.addAction(this.indent(_("Window menu")), Lang.bind(this, function(e) {
                  this.Exec(this.get_camera_command('menu'));
               }));
            }

            if (this.has_camera_support('tooltip'))
            {
               this.menu.addAction(this.indent(_("Tooltip")), Lang.bind(this, function(e) {
                  this.Exec(this.get_camera_command('tooltip'));
               }));
            }

            if (this.has_camera_option('custom'))
            {
               let customOptions = this.get_camera_option('custom');

               for (var title in customOptions) {
                  this.addCustomCameraOption(title, customOptions[title]);

               }
            }
         }

         // Create a simple options submenu for quickly selecting
         // most common options.
         this.optionsMenu = new PopupMenu.PopupSubMenuMenuItem(this.indent(_("Capture options...")));

         // OPTION: Include Cursor (toggle switch)
         let optionSwitch = new StubbornSwitchMenuItem(this.indent(_("Include cursor")), this._includeCursor, { style_class: 'bin' });
         optionSwitch.connect('toggled', Lang.bind(this, function(e1,v) {
            this._includeCursor = v;
            this._settings.set_boolean(KEY_INCLUDE_CURSOR, v);
            if (this.get_camera_program() == CAMERA_PROGRAM_GNOME) {
               // We can't pass a cursor option to gnome-screenshot,
               // so we modify its settings instead.
               this._ssSettings.set_boolean(KEY_GNOME_INCLUDE_CURSOR, v);
            }
            return false;
         }));
         this.optionsMenu.menu.addMenuItem(optionSwitch);

         // OPTION: Capture Delay (combo menu)
         this._inputTitle = new PopupMenu.PopupMenuItem(this.indent(_("Delay")), { reactive: false });

         let item;
         let activeItemNo = this._delay < 5 ? this._delay : 4;  // set active item
         item = new StubbornComboMenuItem(this.indent(_("Delay")), activeItemNo,
          Lang.bind(this, function(e, v) {
            if (v == 4)
            {
               this._delay = 5;
            }
            else
            {
               this._delay = v;
            }

            this._settings.set_int(KEY_DELAY_SECONDS, parseInt(this._delay));

            if (this.get_camera_program() == CAMERA_PROGRAM_GNOME) {
               // We can't pass a delay option to gnome-screenshot,
               // so we modify its settings instead.
               this._ssSettings.set_int(KEY_GNOME_DELAY_SECONDS, parseInt(this._delay));
            }
         }));
         this.optionsMenu.menu.addMenuItem(item);
         this.menu.addMenuItem(this.optionsMenu);
      }

      if (this.has_recorder())
      {
         if (this.has_camera()) {
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
         }

         this._outputTitle2 = new TextImageMenuItem(_("Recorder"), "media-record", false, "right", "sound-volume-menu-item");
         this.menu.addMenuItem(this._outputTitle2);

         if (this.get_recorder_program() == 'cinnamon')
         {
             this._cRecorderItem = this.menu.addAction(this.indent(_("Start recording")), Lang.bind(this, this._toggle_cinnamon_recorder));
             // We could try to listen for when recording is activated
             // by keypress, but we wouldn't be able to differentiate
             // start vs. stop as it isn't exposed to us. So for now,
             // ignore it.
             //global.screen.connect('toggle-recording', Lang.bind(this, this._update_cinnamon_recorder_status));
         }
         else
         {
             if (this.has_recorder_option('custom'))
             {
                let customOptions = this.get_recorder_option('custom');

                for (var title in customOptions) {
                   this.addCustomRecorderOption(title, customOptions[title]);
                }
             }
         }
      }

      // Listen in for shift+clicks so we can alter our behavior accordingly.
      this.menu.actor.connect('key-press-event', Lang.bind(this, this._onMenuKeyPress));
      this.menu.actor.connect('key-release-event', Lang.bind(this, this._onMenuKeyRelease));
   },

   get_camera_filename: function(type) {
      let date = new Date();
      return this._cameraSaveDir + '/' + 
       str_replace(
         ['%Y',
         '%M',
         '%D',
         '%H',
         '%I',
         '%S',
         '%m',
         '%TYPE'],
         [date.getFullYear(),
         this._padNum(date.getMonth() + 1),
         this._padNum(date.getDate()),
         this._padNum(date.getHours()),
         this._padNum(date.getMinutes()),
         this._padNum(date.getSeconds()),
         this._padNum(date.getMilliseconds()),
         Screenshot.SelectionTypeStr[type]
         ],
         this._cameraSavePrefix) + '.png';
   },

   _padNum: function(num) {
      return (num < 10 ? '0' + num : num);
   },

   run_cinnamon_camera: function(type, event) {
      let enableTimer = this._modActivatesTimer ? this.getModifier(Clutter.Shift_L) : this._delay > 0;

      new Screenshot.ScreenshotHelper(type,
         function(){
            global.log('Callback done!');
         }, { 
            includeCursor: this._includeCursor,
            useFlash: this._useCameraFlash,
            includeFrame: this._includeWindowFrame,
            includeStyles: this._includeStyles,
            windowAsArea: this._windowAsArea,
            copyToClipboard: this._copyToClipboard,
            playShutterSound: this._playShutterSound,
            useTimer: enableTimer,
            playTimerSound: this._playIntervalSound,
            timerDuration: this._delay,
            soundTimerInterval: 'dialog-warning',
            soundShutter: 'camera-shutter',
            sendNotification: this._sendNotification,
            filename: this.get_camera_filename(type)
         });
      return true;
   },

   addCustomCameraOption: function(title, cmd) {
      this.menu.addAction(this.indent(title), Lang.bind(this, function(actor, event) {
         this.Exec(this.get_custom_camera_command(title));
      }));
   },

   addCustomRecorderOption: function(title, cmd) {
      this.menu.addAction(this.indent(title), Lang.bind(this, function(actor, event) {
         this.Exec(this.get_custom_recorder_command(title));
      }));
   },

   _update_cinnamon_recorder_status: function(actor) {
      let label = this._cRecorderItem.actor.get_children()[0];
      let newLabel = "";

      if (this.cRecorder.is_recording()) {
         newLabel = "   " + _("Stop recording");
      }
      else {
         newLabel = "   " + _("Start recording");
      }

      label.set_text(newLabel);
   },

   _toggle_cinnamon_recorder: function(actor, event) {
       if (this.cRecorder.is_recording()) {
          this.cRecorder.pause();
          Meta.enable_unredirect_for_screen(global.screen);
       }
       else {
          this.cRecorder.set_framerate(this._crFrameRate);
          this.cRecorder.set_filename('cinnamon-%d%u-%c.' + this._crFileExtension);

          let pipeline = this._crPipeline;
          global.log("Pipeline is " + pipeline);

          if (!pipeline.match(/^\s*$/))
             this.cRecorder.set_pipeline(pipeline);
          else
             this.cRecorder.set_pipeline(null);

          Meta.disable_unredirect_for_screen(global.screen);
          this.cRecorder.record();
       }

       this._update_cinnamon_recorder_status(actor);

       //label.set_text(newLabel);

       //global.screen.emit('toggle-recording');
   },

   _launch_settings: function() {
      Main.Util.spawnCommandLine(AppletDir + "/settings.py");
   },

   get_camera_program: function() {
      return this._cameraProgram;
   },

   has_camera_option: function(option) {
      return this.get_camera_options()[option] != undefined;
   },

   get_camera_option: function(option) {
      return this.get_camera_options()[option];
   },

   get_camera_options: function() {
      return this._programSupport['camera'][this.get_camera_program()];
   },

   get_camera_title: function() {
      return this.get_camera_option('title');
   },

   get_recorder_program: function() {
      return this._recorderProgram;
   },

   has_recorder_option: function(option) {
      return this.get_recorder_options()[option] != undefined
          && this.get_recorder_options()[option] !== false;
   },

   get_recorder_option: function(option) {
      return this.get_recorder_options()[option];
   },

   get_recorder_options: function() {
      return this._programSupport['recorder'][this.get_recorder_program()];
   },

   get_recorder_title: function() {
      return this.get_recorder_option('title');
   },

   has_camera: function() {
      return this._cameraProgram !== null;
   },

   has_recorder: function() {
      return this._recorderProgram !== null;
   },

   has_camera_support: function(fnType) {
      return this._cameraProgram !== null
        && 'supported' in this.get_camera_options()
        && this.get_camera_options()['supported'][fnType] != undefined;
   },

   get_camera_command: function (fnType) {
      let options = this.get_camera_options();
      let supported = this.get_camera_option('supported');

      if (fnType in supported)
      {
         let cmd = supported[fnType];
         if (cmd) {
            return this.get_camera_program() + ' ' + this.command_replacements(cmd, options, true);
         }
         else {
            return "";
         }
      }
      else {
         global.log("Not supported: " + fnType);
      }
   },

   get_custom_camera_command: function (custom) {
      let options = this.get_camera_options();
      let cmd = options['custom'][custom];

      if (cmd) {
         return this.command_replacements(cmd, options, false);
      }
      else {
         return "";
      }
   },

   get_custom_recorder_command: function(custom) {
      let options = this.get_recorder_options();
      let cmd = options['custom'][custom];

      if (cmd) {
         return this.command_replacements(cmd, options, false);
      }
      else {
         return "";
      }
   },

   command_replacements: function(cmd, options, appendCommand) {
      let psCursorOn = options['-cursor-on'];
      let psCursorOff = options['-cursor-off'];
      let psAppend = options['-append'];

      let sCursor = "", sDelay = "", sDefaults = "";

      if (psCursorOn && this._includeCursor)
      {
         sCursor = psCursorOn;
      }
      else if (psCursorOff && !this._includeCursor)
      {
         sCursor = psCursorOff;
      }

      // Rather than repeating same options in support.json, they can
      // be made common to all capture modes for that application.
      if (psAppend && appendCommand == true) {
         cmd = cmd + ' ' + psAppend;
      }

      if (this._delay > 0)
      {
         sDelay = this._delay;
      }

      // Replace tokens from our json support command arguments
      return str_replace(
         ['{DELAY}', '{CURSOR}'],
         [sDelay, sCursor],
         cmd);
   },

   get_program_available: function(program) {
      return this._programs[program] === true;
   },

   _set_program_available: function(program) {
      this._programs[program] = true;
   },

   _set_program_unavailable: function(program) {
      this._programs[program] = false;
   },

   _detect_program: function(program, i) {
      try {
         let [success, out, err, ret] = GLib.spawn_command_line_sync(program + ' --help', out, err, ret);
         this._set_program_available(program);
      }
      catch (e)
      {
         this._set_program_unavailable(program);
      }
   },

   detect_programs: function() {
      let programs = new Array();
      for (var type in this._programSupport) {
         for (var program in this._programSupport[type])
         {
            if (program != 'cinnamon') {
               programs.push(program);
            }
         }
      }
      global.p = programs;

      programs.forEach(Lang.bind(this, this._detect_program));

      if (!this.get_program_available(this._cameraProgram))
      {
         this._recorderProgram = null;
         global.log(this._cameraProgram + ' is not available. Disabling camera functions.');
      }

      if (!this.get_program_available(this._recorderProgram)
          && this._recorderProgram != 'cinnamon')
      {
         this._recorderProgram = null;
         global.log('No screen recorder program is available. Disabling recorder functions.');
      }

      return programs.length;
   },

   Exec: function(cmd) {
      try {
         let success, argc, argv, pid, stdin, stdout, stderr;
         [success,argv] = GLib.shell_parse_argv(cmd);
         [success,pid,stdin,stdout,stderr] =
           GLib.spawn_async_with_pipes(null,argv,null,GLib.SpawnFlags.SEARCH_PATH,null,null);
      }
      catch (e)
      {
         global.log(e);
      }
   },

   TryExec: function(cmd, success, failure) {
      let [success, pid, in_fd, out_fd, err_fd] = GLib.spawn_async_with_pipes(
         null,
         cmd,
         null,
         GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.DO_NOT_REAP_CHILD,
         null);

      let out_reader = new Gio.DataInputStream({ base_stream: new Gio.UnixInputStream({fd: out_fd}) });
      if (success  &&  pid != 0)
      {
         // Wait for answer
         global.log("created process, pid=" + pid);
         GLib.child_watch_add( GLib.PRIORITY_DEFAULT, pid,
            function(pid,status) {
               GLib.spawn_close_pid(pid);
               global.log("process completed, status=" + status);
               let [line, size, buf] = [null, 0, ""];
               while (([line, size] = out_reader.read_line(null)) != null && line != null) {
                  global.log(line);
                  global.log(size);
                  buf += line;
               }
               success(buf);
            });
      }
      else
      {
         global.log("failed process creation");
         typeof failure == 'function' && failure();
      }

      return true;
   },

   on_applet_clicked: function(event) {
      this.menu.toggle();
   },
};

function main(metadata, orientation) {
    let myApplet = new MyApplet(orientation);
    return myApplet;
}

function str_replace (search, replace, subject, count) {
    // http://kevin.vanzonneveld.net
    // +   original by: Kevin van Zonneveld (http://kevin.vanzonneveld.net)
    // +   improved by: Gabriel Paderni
    // +   improved by: Philip Peterson
    // +   improved by: Simon Willison (http://simonwillison.net)
    // +    revised by: Jonas Raoni Soares Silva (http://www.jsfromhell.com)
    // +   bugfixed by: Anton Ongson
    // +      input by: Onno Marsman
    // +   improved by: Kevin van Zonneveld (http://kevin.vanzonneveld.net)
    // +    tweaked by: Onno Marsman
    // +      input by: Brett Zamir (http://brett-zamir.me)
    // +   bugfixed by: Kevin van Zonneveld (http://kevin.vanzonneveld.net)
    // +   input by: Oleg Eremeev
    // +   improved by: Brett Zamir (http://brett-zamir.me)
    // +   bugfixed by: Oleg Eremeev
    // %          note 1: The count parameter must be passed as a string in order
    // %          note 1:  to find a global variable in which the result will be given
    // *     example 1: str_replace(' ', '.', 'Kevin van Zonneveld');
    // *     returns 1: 'Kevin.van.Zonneveld'
    // *     example 2: str_replace(['{name}', 'l'], ['hello', 'm'], '{name}, lars');
    // *     returns 2: 'hemmo, mars'
    var i = 0,
        j = 0,
        temp = '',
        repl = '',
        sl = 0,
        fl = 0,
        f = [].concat(search),
        r = [].concat(replace),
        s = subject,
        ra = Object.prototype.toString.call(r) === '[object Array]',
        sa = Object.prototype.toString.call(s) === '[object Array]';
    s = [].concat(s);
    if (count) {
        this.window[count] = 0;
    }

    for (i = 0, sl = s.length; i < sl; i++) {
        if (s[i] === '') {
            continue;
        }
        for (j = 0, fl = f.length; j < fl; j++) {
            temp = s[i] + '';
            repl = ra ? (r[j] !== undefined ? r[j] : '') : r[0];
            s[i] = (temp).split(f[j]).join(repl);
            if (count && s[i] !== temp) {
                this.window[count] += (temp.length - s[i].length) / f[j].length;
            }
        }
    }
    return sa ? s : s[0];
}