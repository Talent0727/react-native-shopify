/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 * @format
 */

'use strict';
import type {EventTypeShape} from '../../CodegenSchema';

const {generateEventStructName} = require('./CppHelpers');
const {indent} = require('../Utils');

import type {
  ComponentShape,
  NamedShape,
  EventTypeAnnotation,
  SchemaType,
  ObjectTypeAnnotation,
} from '../../CodegenSchema';

// File path -> contents
type FilesOutput = Map<string, string>;

type ComponentCollection = $ReadOnly<{
  [component: string]: ComponentShape,
  ...
}>;

const FileTemplate = ({
  events,
  libraryName,
  extraIncludes,
}: {
  events: string,
  libraryName: string,
  extraIncludes: Set<string>,
}) => `
/**
 * This code was generated by [react-native-codegen](https://www.npmjs.com/package/react-native-codegen).
 *
 * Do not edit this file as changes may cause incorrect behavior and will be lost
 * once the code is regenerated.
 *
 * ${'@'}generated by codegen project: GenerateEventEmitterCpp.js
 */

#include <react/renderer/components/${libraryName}/EventEmitters.h>
${[...extraIncludes].join('\n')}

namespace facebook {
namespace react {
${events}
} // namespace react
} // namespace facebook
`;

const ComponentTemplate = ({
  className,
  eventName,
  structName,
  dispatchEventName,
  implementation,
}: {
  className: string,
  eventName: string,
  structName: string,
  dispatchEventName: string,
  implementation: string,
}) => {
  const capture = implementation.includes('$event')
    ? '$event=std::move($event)'
    : '';
  return `
void ${className}EventEmitter::${eventName}(${structName} $event) const {
  dispatchEvent("${dispatchEventName}", [${capture}](jsi::Runtime &runtime) {
    ${implementation}
  });
}
`;
};

const BasicComponentTemplate = ({
  className,
  eventName,
  dispatchEventName,
}: {
  className: string,
  eventName: string,
  dispatchEventName: string,
}) =>
  `
void ${className}EventEmitter::${eventName}() const {
  dispatchEvent("${dispatchEventName}");
}
`.trim();

function generateSetter(
  variableName: string,
  propertyName: string,
  propertyParts: $ReadOnlyArray<string>,
  valueMapper: string => string = value => value,
) {
  const eventChain = `$event.${[...propertyParts, propertyName].join('.')}`;
  return `${variableName}.setProperty(runtime, "${propertyName}", ${valueMapper(
    eventChain,
  )});`;
}

function generateObjectSetter(
  variableName: string,
  propertyName: string,
  propertyParts: $ReadOnlyArray<string>,
  typeAnnotation: ObjectTypeAnnotation<EventTypeAnnotation>,
  extraIncludes: Set<string>,
) {
  return `
{
  auto ${propertyName} = jsi::Object(runtime);
  ${indent(
    generateSetters(
      propertyName,
      typeAnnotation.properties,
      propertyParts.concat([propertyName]),
      extraIncludes,
    ),
    2,
  )}
  ${variableName}.setProperty(runtime, "${propertyName}", ${propertyName});
}
`.trim();
}

function generateSetters(
  parentPropertyName: string,
  properties: $ReadOnlyArray<NamedShape<EventTypeAnnotation>>,
  propertyParts: $ReadOnlyArray<string>,
  extraIncludes: Set<string>,
): string {
  const propSetters = properties
    .map(eventProperty => {
      const {typeAnnotation} = eventProperty;
      switch (typeAnnotation.type) {
        case 'BooleanTypeAnnotation':
        case 'StringTypeAnnotation':
        case 'Int32TypeAnnotation':
        case 'DoubleTypeAnnotation':
        case 'FloatTypeAnnotation':
          return generateSetter(
            parentPropertyName,
            eventProperty.name,
            propertyParts,
          );
        case 'MixedTypeAnnotation':
          extraIncludes.add('#include <jsi/JSIDynamic.h>');
          return generateSetter(
            parentPropertyName,
            eventProperty.name,
            propertyParts,
            prop => `jsi::valueFromDynamic(runtime, ${prop})`,
          );
        case 'StringEnumTypeAnnotation':
          return generateSetter(
            parentPropertyName,
            eventProperty.name,
            propertyParts,
            prop => `toString(${prop})`,
          );
        case 'ObjectTypeAnnotation':
          return generateObjectSetter(
            parentPropertyName,
            eventProperty.name,
            propertyParts,
            typeAnnotation,
            extraIncludes,
          );
        default:
          (typeAnnotation.type: empty);
          throw new Error(
            `Received invalid event property type ${typeAnnotation.type}`,
          );
      }
    })
    .join('\n');

  return propSetters;
}

function generateEvent(
  componentName: string,
  event: EventTypeShape,
  extraIncludes: Set<string>,
): string {
  // This is a gross hack necessary because native code is sending
  // events named things like topChange to JS which is then converted back to
  // call the onChange prop. We should be consistent throughout the system.
  // In order to migrate to this new system we have to support the current
  // naming scheme. We should delete this once we are able to control this name
  // throughout the system.
  const dispatchEventName = `${event.name[2].toLowerCase()}${event.name.slice(
    3,
  )}`;

  if (event.typeAnnotation.argument) {
    const implementation = `
    auto $payload = jsi::Object(runtime);
    ${generateSetters(
      '$payload',
      event.typeAnnotation.argument.properties,
      [],
      extraIncludes,
    )}
    return $payload;
  `.trim();

    if (!event.name.startsWith('on')) {
      throw new Error('Expected the event name to start with `on`');
    }

    return ComponentTemplate({
      className: componentName,
      eventName: event.name,
      dispatchEventName,
      structName: generateEventStructName([event.name]),
      implementation,
    });
  }

  return BasicComponentTemplate({
    className: componentName,
    eventName: event.name,
    dispatchEventName,
  });
}

module.exports = {
  generate(
    libraryName: string,
    schema: SchemaType,
    packageName?: string,
    assumeNonnull: boolean = false,
  ): FilesOutput {
    const moduleComponents: ComponentCollection = Object.keys(schema.modules)
      .map(moduleName => {
        const module = schema.modules[moduleName];
        if (module.type !== 'Component') {
          return;
        }

        const {components} = module;
        // No components in this module
        if (components == null) {
          return null;
        }

        return components;
      })
      .filter(Boolean)
      .reduce((acc, components) => Object.assign(acc, components), {});

    const extraIncludes = new Set<string>();
    const componentEmitters = Object.keys(moduleComponents)
      .map(componentName => {
        const component = moduleComponents[componentName];
        return component.events
          .map(event => generateEvent(componentName, event, extraIncludes))
          .join('\n');
      })
      .join('\n');

    const fileName = 'EventEmitters.cpp';
    const replacedTemplate = FileTemplate({
      libraryName,
      events: componentEmitters,
      extraIncludes,
    });

    return new Map([[fileName, replacedTemplate]]);
  },
};