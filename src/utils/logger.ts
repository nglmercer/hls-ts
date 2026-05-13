export class Logger {
  private static _enabled: boolean = true;

  static enable(): void {
    this._enabled = true;
  }

  static disable(): void {
    this._enabled = false;
  }

  static get isEnabled(): boolean {
    return this._enabled;
  }

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
