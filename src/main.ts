
import { MixinProvider, ScryptedDeviceType, ScryptedInterface, VideoCamera, Settings, Setting, MotionSensor } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { SettingsMixinDeviceBase } from "../../../common/src/settings-mixin";
import { AutoenableMixinProvider } from '@scrypted/common/src/autoenable-mixin-provider';
import WebSocket from "ws";

const { log, systemManager} = sdk;

class eufyMixin extends SettingsMixinDeviceBase<VideoCamera> implements MotionSensor, Settings {
  sn: string;
  eufyServerHost: string;
  released = false;
  socket: WebSocket;
  messageId: number = 1;
  working = true;

  constructor(mixinDevice: VideoCamera & Settings, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }, providerNativeId: string) {
    super(mixinDevice, mixinDeviceState, {
      providerNativeId,
      mixinDeviceInterfaces,
      group: "eufy Settings",
      groupKey: "eufy",
    });

    this.sn = this.storage.getItem('sn') || "";
    this.eufyServerHost = this.storage.getItem('apiHost') || "";
    if (this.providedInterfaces.includes(ScryptedInterface.MotionSensor)) {
      log.a(`${this.name} has a built in MotionSensor. OpenCV motion processing cancelled. Pleaes disable this extension.`);
      return;
    }

    // to prevent noisy startup/reload/shutdown, delay the prebuffer starting.
    //this.console.log('session starting in 5 seconds');
    //this.console.log(`${this.eufyServerHost} : ${this.sn}`);
    setTimeout(async () => {
      while (!this.released) {
        try {
          await this.start();
          this.console.log('shut down gracefully');
        }
        catch (e) {
          this.console.error(this.name, 'session unexpectedly terminated, restarting in 5 seconds', e);
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
    }, 5000);
  }

  start(): Promise<any> {
    return new Promise((resolve: any, reject: any) => {
      if(this.eufyServerHost == "") {
       reject("no eufy server!");
      }

      this.socket = new WebSocket(this.eufyServerHost);
      var that=this;
      this.socket.on("open", function() {
        const apiSchemaCommand = {
          messageId: that.messageId.toString(),
          command: "set_api_schema",
          schemaVersion: 7
        };
        that.socket.send(JSON.stringify(apiSchemaCommand));
  
        setInterval(() => {
          that.socket.ping();
        }, 5000);
      })
  
      this.socket.on("message", function message(data: any) {
        let obj = JSON.parse(data);
        let messageId = parseInt(obj.messageId);

        //that.console.log(`${JSON.stringify(obj)}`);
  
        if(messageId == 1) {
          const listenCommand = {
            messageId: that.messageId.toString(),
            command: "start_listening"
          };
          that.socket.send(JSON.stringify(listenCommand));
          that.messageId++;
        }

        if(obj.type == "event") {
          if(obj.event.event == "property changed" && obj.event.name == "motionDetected") {
            if(obj.event.serialNumber == that.sn) {
              that.console.log(`MotionState changed from ${that.motionDetected} to ${obj.event.value}`);
              that.motionDetected = obj.event.value;
            }
          }
        }
      })

      this.socket.on('error', (code: number, reason: Buffer) => {
        that.console.log(code);
        reject()
        
      })

      this.socket.on('close', (code: number, reason: Buffer) => {
        that.console.log(code);
        reject()
      })
    })
  }

  async getMixinSettings(): Promise<Setting[]> {
    const settings: Setting[] = [];

    settings.push(
      {
        title: "station sn",
        description: "The station sn.",
        value: this.storage.getItem('sn') || "",
        key: 'sn',
        placeholder: "",
        type: 'string',
      },
      {
        title: "ws host url",
        description: "eufy-secutiry-ws url",
        value: this.storage.getItem('apiHost') || "",
        key: 'apiHost',
        placeholder: "ws://127.0.0.1:3000",
        type: 'string',
      },
    );

    return settings;
  }

  async putMixinSetting(key: string, value: string | number | boolean): Promise<void> {
    this.storage.setItem(key, value.toString());
    if (key === 'sn')
      this.sn = value.toString() || "";
    if (key === 'apiHost')
      this.eufyServerHost = value.toString() || "";
  }

  release() {
    this.released = true;
  }
}

class eufyProvider extends AutoenableMixinProvider implements MixinProvider {
  constructor(nativeId?: string) {
    super(nativeId);
  }

  async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
    if (!interfaces.includes(ScryptedInterface.VideoCamera) || interfaces.includes(ScryptedInterface.MotionSensor))
      return null;
    return [ScryptedInterface.MotionSensor, ScryptedInterface.Settings];
  }

  async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }) {
    this.setHasEnabledMixin(mixinDeviceState.id);
    return new eufyMixin(mixinDevice, mixinDeviceInterfaces, mixinDeviceState, this.nativeId);
  }

  async releaseMixin(id: string, mixinDevice: any) {
    mixinDevice.release();
  }
}

export default new eufyProvider();
