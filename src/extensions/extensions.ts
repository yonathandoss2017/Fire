/*!
 * @license
 * Copyright 2021 Google Inc.
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

  public runtime(): Runtime {
    return new Runtime(this.client);
  }
}

class Runtime {
  private projectId: string;
  private extensionInstanceId: string;
  private readonly client: ExtensionsApiClient;

  constructor(client: ExtensionsApiClient) {
    this.projectId = this.getProjectId();
    if (!validator.isNonEmptyString(process.env['EXT_INSTANCE_ID'])) {
      throw new FirebaseExtensionsError(
        'invalid-argument',
        'Runtime can only available from within a running Extension instance.'
      );
    }
    this.extensionInstanceId = process.env['EXT_INSTANCE_ID'];
    if (!validator.isNonNullObject(client) || !('updateRuntimeData' in client) || !('getRuntimeData' in client)) {
      throw new FirebaseExtensionsError(
        'invalid-argument',
        'Must provide a valid ExtensionsApiClient instance to create a new Runtime.');
    }
    this.client = client;
  }

  async setProcessingState(state: SettableProcessingState, detailMessage: string): Promise<void> {
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

  async setFatalError(errorMessage: string): Promise<void> {
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
