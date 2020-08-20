/*!
 * Copyright 2020 Google Inc.
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

import { FirebaseApp } from '../firebase-app';
import { FirebaseServiceInterface, FirebaseServiceInternalsInterface } from '../firebase-service';
import { MachineLearningApiClient, ModelResponse, ModelOptions,
  ModelUpdateOptions, ListModelsOptions, isGcsTfliteModelOptions } from './machine-learning-api-client';
import { FirebaseError } from '../utils/error';

import * as validator from '../utils/validator';
import { FirebaseMachineLearningError } from './machine-learning-utils';
import { deepCopy } from '../utils/deep-copy';
import * as utils from '../utils';

/**
 * Internals of an ML instance.
 */
class MachineLearningInternals implements FirebaseServiceInternalsInterface {
  /**
   * Deletes the service and its associated resources.
   *
   * @return {Promise<void>} An empty Promise that will be resolved when the
   *     service is deleted.
   */
  public delete(): Promise<void> {
    // There are no resources to clean up.
    return Promise.resolve();
  }
}

/** Response object for a listModels operation. */
export interface ListModelsResult {
  models: Model[];
  pageToken?: string;
}

/**
 * The Firebase Machine Learning class
 */
export class MachineLearning implements FirebaseServiceInterface {
  public readonly INTERNAL = new MachineLearningInternals();

  private readonly client: MachineLearningApiClient;
  private readonly appInternal: FirebaseApp;

  /**
   * @param {FirebaseApp} app The app for this ML service.
   * @constructor
   */
  constructor(app: FirebaseApp) {
    if (!validator.isNonNullObject(app) || !('options' in app)) {
      throw new FirebaseError({
        code: 'machine-learning/invalid-argument',
        message: 'First argument passed to admin.machineLearning() must be a ' +
            'valid Firebase app instance.',
      });
    }

    this.appInternal = app;
    this.client = new MachineLearningApiClient(app);
  }

  /**
   * Returns the app associated with this ML instance.
   *
   * @return {FirebaseApp} The app associated with this ML instance.
   */
  public get app(): FirebaseApp {
    return this.appInternal;
  }

  /**
   * Creates a model in the current Firebase project.
   *
   * @param {ModelOptions} model The model to create.
   *
   * @return {Promise<Model>} A Promise fulfilled with the created model.
   */
  public createModel(model: ModelOptions): Promise<Model> {
    return this.signUrlIfPresent(model)
      .then((modelContent) => this.client.createModel(modelContent))
      .then((operation) => this.client.handleOperation(operation))
      .then((modelResponse) => new Model(modelResponse, this.client));
  }

  /**
   * Updates a model's metadata or model file.
   *
   * @param {string} modelId The ID of the model to update.
   * @param {ModelOptions} model The model fields to update.
   *
   * @return {Promise<Model>} A Promise fulfilled with the updated model.
   */
  public updateModel(modelId: string, model: ModelOptions): Promise<Model> {
    const updateMask = utils.generateUpdateMask(model);
    return this.signUrlIfPresent(model)
      .then((modelContent) => this.client.updateModel(modelId, modelContent, updateMask))
      .then((operation) => this.client.handleOperation(operation))
      .then((modelResponse) => new Model(modelResponse, this.client));
  }

  /**
   * Publishes a Firebase ML model.
   *
   * A published model can be downloaded to client apps.
   *
   * @param {string} modelId The ID of the model to publish.
   *
   * @return {Promise<Model>} A Promise fulfilled with the published model.
   */
  public publishModel(modelId: string): Promise<Model> {
    return this.setPublishStatus(modelId, true);
  }

  /**
   * Unpublishes a Firebase ML model.
   *
   * @param {string} modelId The ID of the model to unpublish.
   *
   * @return {Promise<Model>} A Promise fulfilled with the unpublished model.
   */
  public unpublishModel(modelId: string): Promise<Model> {
    return this.setPublishStatus(modelId, false);
  }

  /**
   * Gets the model specified by the given ID.
   *
   * @param {string} modelId The ID of the model to get.
   *
   * @return {Promise<Model>} A Promise fulfilled with the model.
   */
  public getModel(modelId: string): Promise<Model> {
    return this.client.getModel(modelId)
      .then((modelResponse) => new Model(modelResponse, this.client));
  }

  /**
   * Lists the current project's models.
   *
   * @param {ListModelsOptions} options The listing options.
   *
   * @return {Promise<{models: Model[], pageToken?: string}>} A promise that
   *     resolves with the current (filtered) list of models and the next page
   *     token. For the last page, an empty list of models and no page token are
   *     returned.
   */
  public listModels(options: ListModelsOptions = {}): Promise<ListModelsResult> {
    return this.client.listModels(options)
      .then((resp) => {
        if (!validator.isNonNullObject(resp)) {
          throw new FirebaseMachineLearningError(
            'invalid-argument',
            `Invalid ListModels response: ${JSON.stringify(resp)}`);
        }
        let models: Model[] = [];
        if (resp.models) {
          models = resp.models.map((rs) =>  new Model(rs, this.client));
        }
        const result: ListModelsResult = { models };
        if (resp.nextPageToken) {
          result.pageToken = resp.nextPageToken;
        }
        return result;
      });
  }

  /**
   * Deletes a model from the current project.
   *
   * @param {string} modelId The ID of the model to delete.
   */
  public deleteModel(modelId: string): Promise<void> {
    return this.client.deleteModel(modelId);
  }

  private setPublishStatus(modelId: string, publish: boolean): Promise<Model> {
    const updateMask = ['state.published'];
    const options: ModelUpdateOptions = { state: { published: publish } };
    return this.client.updateModel(modelId, options, updateMask)
      .then((operation) => this.client.handleOperation(operation))
      .then((modelResponse) => new Model(modelResponse, this.client));
  }

  private signUrlIfPresent(options: ModelOptions): Promise<ModelOptions> {
    const modelOptions = deepCopy(options);
    if (isGcsTfliteModelOptions(modelOptions)) {
      return this.signUrl(modelOptions.tfliteModel.gcsTfliteUri)
        .then((uri: string) => {
          modelOptions.tfliteModel.gcsTfliteUri = uri;
          return modelOptions;
        })
        .catch((err: Error) => {
          throw new FirebaseMachineLearningError(
            'internal-error',
            `Error during signing upload url: ${err.message}`);
        });
    }
    return Promise.resolve(modelOptions);
  }

  private signUrl(unsignedUrl: string): Promise<string> {
    const MINUTES_IN_MILLIS = 60 * 1000;
    const URL_VALID_DURATION = 10 * MINUTES_IN_MILLIS;

    const gcsRegex = /^gs:\/\/([a-z0-9_.-]{3,63})\/(.+)$/;
    const matches = gcsRegex.exec(unsignedUrl);
    if (!matches) {
      throw new FirebaseMachineLearningError(
        'invalid-argument',
        `Invalid unsigned url: ${unsignedUrl}`);
    }
    const bucketName = matches[1];
    const blobName = matches[2];
    const bucket = this.appInternal.storage().bucket(bucketName);
    const blob = bucket.file(blobName);
    return blob.getSignedUrl({
      action: 'read',
      expires: Date.now() + URL_VALID_DURATION,
    }).then((signUrl) => signUrl[0]);
  }
}

/**
 * A Firebase ML Model output object.
 */
export class Model {
  private model: ModelResponse;
  private readonly client?: MachineLearningApiClient;

  constructor(model: ModelResponse, client: MachineLearningApiClient) {
    this.model = Model.validateAndClone(model);
    this.client = client;
  }

  /** The ID of the model. */
  get modelId(): string {
    return extractModelId(this.model.name);
  }

  /** The model's display name. This is the value you use to refer
      to the model in the iOS and Android libraries. */
  get displayName(): string {
    return this.model.displayName!;
  }

  /** The model's tags. */
  get tags(): string[] {
    return this.model.tags || [];
  }

  /** The date and time the model was created (added to the project). */
  get createTime(): string {
    return new Date(this.model.createTime).toUTCString();
  }

  /** The date and time the model was last updated. */
  get updateTime(): string {
    return new Date(this.model.updateTime).toUTCString();
  }

  /** The validation error message, if the model isn't valid. */
  get validationError(): string | undefined {
    return this.model.state?.validationError?.message;
  }

  /** True if the model is published and available to download. */
  get published(): boolean {
    return this.model.state?.published || false;
  }

  /** The model's ETag. */
  get etag(): string {
    return this.model.etag;
  }

  /** The SHA256 hash of the model file. */
  get modelHash(): string | undefined {
    return this.model.modelHash;
  }

  /** The model's tflite file. */
  get tfliteModel(): TFLiteModel | undefined {
    // Make a copy so people can't directly modify the private this.model object.
    return deepCopy(this.model.tfliteModel);
  }

  /**
   * Locked indicates if there are active long running operations on the model.
   * Models may not be modified when they are locked.
   */
  public get locked(): boolean {
    return (this.model.activeOperations?.length ?? 0) > 0;
  }

  public toJSON(): {[key: string]: any} {
    // We can't just return this.model because it has extra fields and
    // different formats etc. So we build the expected model object.
    const jsonModel: {[key: string]: any}  = {
      modelId: this.modelId,
      displayName: this.displayName,
      tags: this.tags,
      createTime: this.createTime,
      updateTime: this.updateTime,
      published: this.published,
      etag: this.etag,
      locked: this.locked,
    };

    // Also add possibly undefined fields if they exist.

    if (this.validationError) {
      jsonModel['validationError'] = this.validationError;
    }

    if (this.modelHash) {
      jsonModel['modelHash'] = this.modelHash;
    }

    if (this.tfliteModel) {
      jsonModel['tfliteModel'] = this.tfliteModel;
    }

    return jsonModel;
  }


  /**
   * Wait for the active operations on the model to complete.
   * @param maxTimeMillis The number of milliseconds to wait for the model to be unlocked. If unspecified,
   *     a default will be used.
   */
  public waitForUnlocked(maxTimeMillis?: number): Promise<void> {
    if ((this.model.activeOperations?.length ?? 0) > 0) {
      // The client will always be defined on Models that have activeOperations
      // because models with active operations came back from the server and
      // were constructed with a non-empty client.
      return this.client!.handleOperation(this.model.activeOperations![0], { wait: true, maxTimeMillis })
        .then((modelResponse) => {
          this.model = Model.validateAndClone(modelResponse);
        });
    }
    return Promise.resolve();
  }

  private static validateAndClone(model: ModelResponse): ModelResponse {
    if (!validator.isNonNullObject(model) ||
    !validator.isNonEmptyString(model.name) ||
    !validator.isNonEmptyString(model.createTime) ||
    !validator.isNonEmptyString(model.updateTime) ||
    !validator.isNonEmptyString(model.displayName) ||
    !validator.isNonEmptyString(model.etag)) {
      throw new FirebaseMachineLearningError(
        'invalid-server-response',
        `Invalid Model response: ${JSON.stringify(model)}`);
    }
    const tmpModel = deepCopy(model);

    // If tflite Model is specified, it must have a source consisting of
    // oneof {gcsTfliteUri, automlModel}
    if (model.tfliteModel &&
        !validator.isNonEmptyString(model.tfliteModel.gcsTfliteUri) &&
        !validator.isNonEmptyString(model.tfliteModel.automlModel)) {
      // If we have some other source, ignore the whole tfliteModel.
      delete (tmpModel as any).tfliteModel;
    }


    // Remove '@type' field. We don't need it.
    if ((tmpModel as any)["@type"]) {
      delete (tmpModel as any)["@type"];
    }
    return tmpModel;
  }
}

/**
 * A TFLite Model output object
 *
 * One of either the `gcsTfliteUri` or `automlModel` properties will be defined
 * and non-empty.
 */
export interface TFLiteModel {
  readonly sizeBytes: number;

  // Oneof these two
  readonly gcsTfliteUri?: string;
  readonly automlModel?: string;
}

function extractModelId(resourceName: string): string {
  return resourceName.split('/').pop()!;
}
