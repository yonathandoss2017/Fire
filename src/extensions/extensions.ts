/*!
 * @license
 * Copyright 2022 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { App } from '../app';
import { SettableProcessingState } from './extensions-api';
import { ExtensionsApiClient, FirebaseExtensionsError } from './extensions-api-client-internal';
import * as validator from '../utils/validator';

/**
 * The Firebase `Extensions` service interface.
 */
export class Extensions {
  private readonly client: ExtensionsApiClient;
  /**
   * @param app - The app for this `Extensions` service.
   * @constructor
   * @internal
   */
  constructor(readonly app: App) {
    this.client = new ExtensionsApiClient(app);
  }

  /**
   * The runtime() method returns a new Runtime, which provides methods to modify an extension instance's runtime data.
   * 
   * @returns A new Runtime object.
   */
  public runtime(): Runtime {
    return new Runtime(this.client);
  }
}

/**
 * Runtime provides methods to modify an extension instance's runtime data.
 */
class Runtime {
  private projectId: string;
  private extensionInstanceId: string;
  private readonly client: ExtensionsApiClient;
  /**
   * @param client - The Api client for this `Runtime` service.
   * @constructor
   * @internal
   */
  constructor(client: ExtensionsApiClient) {
    this.projectId = this.getProjectId();
    if (!validator.isNonEmptyString(process.env['EXT_INSTANCE_ID'])) {
      throw new FirebaseExtensionsError(
        'invalid-argument',
        'Runtime is only available from within a running Extension instance.'
      );
    }
    this.extensionInstanceId = process.env['EXT_INSTANCE_ID'];
    if (!validator.isNonNullObject(client) || !('updateRuntimeData' in client)) {
      throw new FirebaseExtensionsError(
        'invalid-argument',
        'Must provide a valid ExtensionsApiClient instance to create a new Runtime.');
    }
    this.client = client;
  }

  /**
   * Sets the processing state of an extension instance.
   *
   * Use this method to report the results of a lifecycle event handler. If the 
   * lifecycle event failed & the extension instance will no longer work 
   * correctly, use `setFatalError` instead.
   * 
   * @param state - The state to set the instance to.
   * @param detailMessage - A message explaining the results of the lifecycle function.
   */
  public async setProcessingState(state: SettableProcessingState, detailMessage: string): Promise<void> {
    await this.client.updateRuntimeData(
      this.projectId,
      this.extensionInstanceId,
      {
        processingState: {
          state,
          detailMessage,
        },
      },
    );
  }

  /**
   * Sets the `fatalError` of an `ExtensionInstance`.
   * It should be used when a lifecycle event fails in a way that makes the Instance inoperable.
   * If the lifecycle event failed but the instance will still work as expected,
   * use setProcessingState with the "PROCESSING_WARNING" or "PROCESSING_FAILED" state instead.
   * 
   * @param errorMessage - A message explaining what went wrong and how to fix it.
   */
  public async setFatalError(errorMessage: string): Promise<void> {
    if (!validator.isNonEmptyString(errorMessage)) {
      throw new FirebaseExtensionsError(
        'invalid-argument',
        'errorMessage must not be empty'
      );
    }
    await this.client.updateRuntimeData(
      this.projectId,
      this.extensionInstanceId,
      {
        fatalError: {
          errorMessage,
        },
      },
    );
  }

  private getProjectId(): string {
    const projectId = process.env['PROJECT_ID'];
    if (!validator.isNonEmptyString(projectId)) {
      throw new FirebaseExtensionsError(
        'invalid-argument',
        'Expected PROJECT_ID not to be undefined in Extensions runtime enviornment'
      );
    }
    return projectId;
  }
}
