import glob from "glob";
import fs from "fs";
import path from "path";
import { Schema, SchemaDefinition } from "mongoose";
import commander from "commander";

const program = new commander.Command();

program
  .option("-i, --input <path>", "Path to schema files", "./models")
  .option("-o, --output <path>", "Path to output ERD file", "./erd.mmd")
  .parse(process.argv);

const options = program.opts();
const inputPath = options.input;
const outputPath = options.output;

// Step 1: Find Schema files
const schemaFiles = glob.sync(inputPath, {
  ignore: "node_modules/**",
});

// Step 2: Generate ERD code using Mermaid syntax
let erdCode = "erDiagram\n";

function isNestedObject(input: Record<string, unknown>): boolean {
  const allowedProperties = ["label", "type", "default", "enum"];

  for (const key in input) {
    if (!allowedProperties.includes(key)) {
      return true;
    }
  }

  return false;
}

function findFirstObject(arr: unknown[]): unknown | undefined {
  for (const item of arr) {
    if (typeof item === "object" && item !== null && !Array.isArray(item)) {
      return item;
    }

    if (Array.isArray(item)) {
      const nestedResult = findFirstObject(item);
      if (nestedResult !== undefined) {
        return nestedResult;
      }
    }
  }

  return undefined;
}

function generateEntity(
  erdCode: string,
  schemaName: string,
  schema: SchemaDefinition
): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nestedSchemas: { name: string; field: any }[] = [];

  erdCode += `${schemaName} {\n`;

  // Generate single attributes
  // @ts-ignore
  for (const key in schema.obj) {
    const field = schema.obj[key];
    const formattedField = formatField(key, field);
    erdCode += `  ${formattedField}\n`;
  }

  erdCode += "}\n";

  // Generate relationships and nested objects
  // @ts-ignore
  for (const key in schema.obj) {
    const field = schema.obj[key];

    if (field.ref) {
      const refSchemaName = field.ref;
      erdCode += `${schemaName} ||--o{ "${refSchemaName}" : "${key}"\n`;
    } else if (Array.isArray(field) && field[0].ref) {
      const refSchemaName = field[0].ref;
      erdCode += `${schemaName} ||--o{ "${refSchemaName}" : "${key}"\n`;
    } else if (
      Array.isArray(field) ||
      (field instanceof Object && !field.ref && !field.type)
    ) {
      if (!isNestedObject(Array.isArray(field) ? field[0] : field)) {
        continue;
      }

      const nestedSchemaName = `${schemaName}_${key}`;
      erdCode += `${schemaName} ||--o{ "${nestedSchemaName}" : "${key}"\n`;

      const inputField = Array.isArray(field) ? findFirstObject(field) : field;
      nestedSchemas.push({ name: nestedSchemaName, field: inputField });
    }
  }

  if (nestedSchemas.length) {
    nestedSchemas.forEach((nestedSchema) => {
      const { name, field } = nestedSchema;
      console.log(`nestedSchema: ${name}`);
      erdCode = generateEntity(erdCode, name, { obj: field });
    });
  }

  return erdCode;
}

schemaFiles.forEach((schemaFile) => {
  const filePath = path.join(__dirname, schemaFile);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const schema: SchemaDefinition = require(filePath);

  if (schema) {
    const schemaName = path.basename(schemaFile, ".ts");
    erdCode = generateEntity(erdCode, schemaName, schema);
  }
});

type SchemaType = (typeof Schema.Types)[keyof typeof Schema.Types]; // Define a union type of all Schema types

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapFieldType(field: any): string {
  const typeMap = new Map<SchemaType, string>([
    [Schema.Types.String, "string"],
    [Schema.Types.Number, "number"],
    [Schema.Types.Date, "date"],
    [Schema.Types.Boolean, "boolean"],
    [Schema.Types.ObjectId, "id"],
  ]);

  let mapedValue = typeMap.get(field.type);
  if (!mapedValue) {
    if (field instanceof Object) {
      mapedValue = "object";
    } else {
      mapedValue = "unlnown";
    }
  }

  return mapedValue;
}

// Helper function to format a field
function formatField(fieldName: string, field: SchemaDefinition): string {
  let fieldType = "unknown";
  const fieldLabel = field?.label;
  let fieldEnum = field?.enum;
  let fieldDefault = field?.default;

  if (field.type === Schema.Types.String) {
    fieldType = "string";
  } else if (field.type === Schema.Types.Number) {
    fieldType = "number";
  } else if (field.type === Schema.Types.Date) {
    fieldType = "date";
  } else if (field.type === Schema.Types.Boolean) {
    fieldType = "boolean";
  } else if (field.type === Schema.Types.ObjectId) {
    fieldType = "id";
  } else if (Array.isArray(field)) {
    fieldType = `${mapFieldType(field[0])}[]`;
    if (field[0].enum) {
      fieldEnum = field[0].enum;
    }
    if (field[0].fieldDefault) {
      fieldDefault = field[0].default;
    }
  } else if (field instanceof Object) {
    fieldType = "object";
  }

  let output = `${fieldType} ${fieldName}`;
  if (fieldLabel || fieldEnum || fieldDefault) {
    const toAdd = fieldEnum || fieldDefault || fieldLabel;
    output += ` "${toAdd}"`;
  }

  return output;
}

// Step 3: Save the ERD code to a file
const erdFilePath = path.join(outputPath, "erd.mmd");
fs.writeFileSync(erdFilePath, erdCode, "utf-8");
// Step 4: Convert Mermaid code to an image using the Mermaid CLI
// const mermaidCommand = `mmdc -i ${erdFilePath} -o erd.png`;
// execSync(mermaidCommand);

console.log("ER Diagram generated successfully.");
