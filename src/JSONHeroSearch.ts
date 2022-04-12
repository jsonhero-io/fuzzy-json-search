import { inferType } from "@jsonhero/json-infer-types";
import { JSONHeroPath } from "@jsonhero/path";
import LRUCache from "lru-cache";
import { IItemAccessor, ItemScore, prepareQuery } from "./fuzzyScoring";
import { search, SearchResult } from "./search";

export type JSONHeroSearchOptions = {
  cacheSettings?: {
    max?: number;
  };
};

export class JSONHeroSearch {
  json: unknown;
  items: JSONHeroPath[];
  accessor: IItemAccessor<JSONHeroPath>;
  scoreCache: Map<number, ItemScore> = new Map();
  searchCache: LRUCache<string, Array<SearchResult<JSONHeroPath>>>;

  constructor(json: unknown, options?: JSONHeroSearchOptions) {
    this.json = json;
    this.items = [];
    this.accessor = new JSONHeroPathAccessor(this.json);

    this.searchCache = new LRUCache<string, Array<SearchResult<JSONHeroPath>>>({
      max: options?.cacheSettings?.max ?? 100,
    });
  }

  prepareIndex() {
    if (this.items.length > 0) {
      return;
    }

    this.items = getAllPaths(this.json);
  }

  search(query: string): Array<SearchResult<JSONHeroPath>> {
    if (this.searchCache.has(query)) {
      return this.searchCache.get(query) ?? [];
    }

    this.prepareIndex();

    const preparedQuery = prepareQuery(query);

    const results = search(this.items, preparedQuery, true, this.accessor, this.scoreCache);

    this.searchCache.set(query, results);

    return results;
  }
}

export class JSONHeroPathAccessor implements IItemAccessor<JSONHeroPath> {
  json: unknown;
  valueCache: Map<string, string> = new Map<string, string>();

  constructor(json: unknown) {
    this.json = json;
  }

  getIsArrayItem(path: JSONHeroPath): boolean {
    return path.lastComponent!.isArray;
  }

  getItemLabel(path: JSONHeroPath): string {
    return path.lastComponent!.toString();
  }

  getItemDescription(path: JSONHeroPath): string {
    // Get all but the first and last component
    const components = path.components.slice(1, -1);

    return components.map((c) => c.toString()).join(".");
  }

  getItemPath(path: JSONHeroPath): string {
    // Get all but the first component
    const components = path.components.slice(1);

    return components.map((c) => c.toString()).join(".");
  }

  getRawValue(path: JSONHeroPath): string | undefined {
    const cacheKey = `${path.toString()}_raw`;

    if (this.valueCache.has(cacheKey)) {
      return this.valueCache.get(cacheKey);
    }

    const rawValue = doGetRawValue(this.json);

    if (rawValue) {
      this.valueCache.set(cacheKey, rawValue);
    }

    return rawValue;

    function doGetRawValue(json: unknown) {
      const inferred = inferType(path.first(json));

      switch (inferred.name) {
        case "string":
          return inferred.value;
        case "int":
        case "float":
          return inferred.value.toString();
        case "null":
          return "null";
        case "bool":
          return inferred.value ? "true" : "false";
        default:
          return;
      }
    }
  }

  getFormattedValue(path: JSONHeroPath): string | undefined {
    const cacheKey = `${path.toString()}_formatted`;

    if (this.valueCache.has(cacheKey)) {
      return this.valueCache.get(cacheKey);
    }

    const formattedValue = doGetFormattedValue(this.json);

    if (formattedValue) {
      this.valueCache.set(cacheKey, formattedValue);
    }

    return formattedValue;

    function doGetFormattedValue(json: unknown) {
      const inferred = inferType(path.first(json));

      switch (inferred.name) {
        case "string": {
          if (!inferred.format) {
            return inferred.value;
          }

          switch (inferred.format.name) {
            case "datetime": {
              const date = new Date(inferred.value);

              return date.toString();
            }
            default: {
              return inferred.value;
            }
          }
        }
        case "int":
        case "float":
          return inferred.value.toString();
        case "null":
          return "null";
        case "bool":
          return inferred.value ? "true" : "false";
        default:
          return;
      }
    }
  }
}

function getAllPaths(json: unknown): Array<JSONHeroPath> {
  const paths: Array<JSONHeroPath> = [];

  function walk(json: unknown, path: JSONHeroPath) {
    paths.push(path);

    if (Array.isArray(json)) {
      for (let i = 0; i < json.length; i++) {
        walk(json[i], path.child(i.toString()));
      }
    } else if (typeof json === "object" && json !== null) {
      for (const key of Object.keys(json)) {
        walk(json[key as keyof typeof json], path.child(key));
      }
    }
  }

  walk(json, new JSONHeroPath("$"));

  return paths;
}
