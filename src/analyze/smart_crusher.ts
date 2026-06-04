export class SmartCrusher {
  public static crush(content: string): string {
    try {
      const parsed = JSON.parse(content);
      const crushedObj = this.traverseAndCrush(parsed);
      return JSON.stringify(crushedObj);
    } catch (e) {
      return content;
    }
  }

  private static traverseAndCrush(val: any): any {
    if (Array.isArray(val)) {
      if (val.length <= 2) {
        return val.map(item => this.traverseAndCrush(item));
      }
      const slice = val.slice(0, 2).map(item => this.traverseAndCrush(item));
      return [...slice, `<truncated ${val.length - 2} items>`];
    }
    if (val !== null && typeof val === "object") {
      const newObj: Record<string, any> = {};
      for (const key of Object.keys(val)) {
        newObj[key] = this.traverseAndCrush(val[key]);
      }
      return newObj;
    }
    return val;
  }
}
