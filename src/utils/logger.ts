export class Logger {
  private _prefix: string;
  private static _enabled: boolean = true;

  constructor(prefix: string) {
    this._prefix = `[${prefix}]`;
  }

  static enable(): void {
    this._enabled = true;
  }

  static disable(): void {
    this._enabled = false;
  }

  static get isEnabled(): boolean {
    return this._enabled;
  }

  log(message?: any, ...optionalParams: any[]): void {
    if (Logger._enabled) {
      console.log(this._prefix, message, ...optionalParams);
    }
  }

  warn(message?: any, ...optionalParams: any[]): void {
    if (Logger._enabled) {
      console.warn(this._prefix, message, ...optionalParams);
    }
  }

  error(message?: any, ...optionalParams: any[]): void {
    if (Logger._enabled) {
      console.error(this._prefix, message, ...optionalParams);
    }
  }

  // Legacy static support for simple migration
  static log(message?: any, ...optionalParams: any[]): void {
    if (this._enabled) {
      console.log(message, ...optionalParams);
    }
  }

  static warn(message?: any, ...optionalParams: any[]): void {
    if (this._enabled) {
      console.warn(message, ...optionalParams);
    }
  }

  static error(message?: any, ...optionalParams: any[]): void {
    if (this._enabled) {
      console.error(message, ...optionalParams);
    }
  }
}
