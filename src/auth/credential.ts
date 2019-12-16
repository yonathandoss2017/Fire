/*!
 * Copyright 2017 Google Inc.
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

// Use untyped import syntax for Node built-ins
import fs = require('fs');
import os = require('os');
import path = require('path');

import {AppErrorCodes, FirebaseAppError} from '../utils/error';
import {HttpClient, HttpRequestConfig, HttpError, HttpResponse} from '../utils/api-request';
import {Agent} from 'http';

const GOOGLE_TOKEN_AUDIENCE = 'https://accounts.google.com/o/oauth2/token';
const GOOGLE_AUTH_TOKEN_HOST = 'accounts.google.com';
const GOOGLE_AUTH_TOKEN_PATH = '/o/oauth2/token';

// NOTE: the Google Metadata Service uses HTTP over a vlan
const GOOGLE_METADATA_SERVICE_HOST = 'metadata.google.internal';
const GOOGLE_METADATA_SERVICE_TOKEN_PATH = '/computeMetadata/v1/instance/service-accounts/default/token';
const GOOGLE_METADATA_SERVICE_PROJECT_ID_PATH = '/computeMetadata/v1/project/project-id';

const configDir = (() => {
  // Windows has a dedicated low-rights location for apps at ~/Application Data
  const sys = os.platform();
  if (sys && sys.length >= 3 && sys.substring(0, 3).toLowerCase() === 'win') {
    return process.env.APPDATA;
  }

  // On *nix the gcloud cli creates a . dir.
  return process.env.HOME && path.resolve(process.env.HOME, '.config');
})();

const GCLOUD_CREDENTIAL_SUFFIX = 'gcloud/application_default_credentials.json';
const GCLOUD_CREDENTIAL_PATH = configDir && path.resolve(configDir, GCLOUD_CREDENTIAL_SUFFIX);

const REFRESH_TOKEN_HOST = 'www.googleapis.com';
const REFRESH_TOKEN_PATH = '/oauth2/v4/token';

const ONE_HOUR_IN_SECONDS = 60 * 60;
const JWT_ALGORITHM = 'RS256';

/**
 * Interface for Google OAuth 2.0 access tokens.
 */
export interface GoogleOAuthAccessToken {
  /* tslint:disable:variable-name */
  access_token: string;
  expires_in: number;
  /* tslint:enable:variable-name */
}

/**
 * Interface for things that generate access tokens.
 */
export interface Credential {
  getAccessToken(): Promise<GoogleOAuthAccessToken>;
}

/**
 * Implementation of Credential that uses a service account certificate.
 */
export class ServiceAccountCredential implements Credential {

  public readonly projectId: string;
  public readonly privateKey: string;
  public readonly clientEmail: string;


  private readonly httpClient: HttpClient;
  private readonly httpAgent?: Agent;

  constructor(serviceAccountPathOrObject: string | object, httpAgent?: Agent) {
    const serviceAccount = (typeof serviceAccountPathOrObject === 'string') ?
      ServiceAccount.fromPath(serviceAccountPathOrObject)
      : new ServiceAccount(serviceAccountPathOrObject);
    this.projectId = serviceAccount.projectId;
    this.privateKey = serviceAccount.privateKey;
    this.clientEmail = serviceAccount.clientEmail;
    this.httpClient = new HttpClient();
    this.httpAgent = httpAgent;
  }

  public getAccessToken(): Promise<GoogleOAuthAccessToken> {
    const token = this.createAuthJwt_();
    const postData = 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3A' +
      'grant-type%3Ajwt-bearer&assertion=' + token;
    const request: HttpRequestConfig = {
      method: 'POST',
      url: `https://${GOOGLE_AUTH_TOKEN_HOST}${GOOGLE_AUTH_TOKEN_PATH}`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      data: postData,
      httpAgent: this.httpAgent,
    };
    return requestAccessToken(this.httpClient, request);
  }

  private createAuthJwt_(): string {
    const claims = {
      scope: [
        'https://www.googleapis.com/auth/cloud-platform',
        'https://www.googleapis.com/auth/firebase.database',
        'https://www.googleapis.com/auth/firebase.messaging',
        'https://www.googleapis.com/auth/identitytoolkit',
        'https://www.googleapis.com/auth/userinfo.email',
      ].join(' '),
    };

    const jwt = require('jsonwebtoken');
    // This method is actually synchronous so we can capture and return the buffer.
    return jwt.sign(claims, this.privateKey, {
      audience: GOOGLE_TOKEN_AUDIENCE,
      expiresIn: ONE_HOUR_IN_SECONDS,
      issuer: this.clientEmail,
      algorithm: JWT_ALGORITHM,
    });
  }
}

/**
 * A struct containing the properties necessary to use service-account JSON credentials.
 */
class ServiceAccount {

  public readonly projectId: string;
  public readonly privateKey: string;
  public readonly clientEmail: string;

  public static fromPath(filePath: string): ServiceAccount {
    // Node bug encountered in v6.x. fs.readFileSync hangs when path is a 0 or 1.
    if (typeof filePath !== 'string') {
      throw new FirebaseAppError(
        AppErrorCodes.INVALID_CREDENTIAL,
        'Failed to parse service account json file: TypeError: path must be a string',
      );
    }

    try {
      return new ServiceAccount(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } catch (error) {
      // Throw a nicely formed error message if the file contents cannot be parsed
      throw new FirebaseAppError(
        AppErrorCodes.INVALID_CREDENTIAL,
        'Failed to parse service account json file: ' + error,
      );
    }
  }

  constructor(json: object) {
    if (typeof json !== 'object' || json === null) {
      throw new FirebaseAppError(
        AppErrorCodes.INVALID_CREDENTIAL,
        'Service account must be an object.',
      );
    }

    copyAttr(this, json, 'projectId', 'project_id');
    copyAttr(this, json, 'privateKey', 'private_key');
    copyAttr(this, json, 'clientEmail', 'client_email');

    let errorMessage;
    if (typeof this.projectId !== 'string' || !this.projectId) {
      errorMessage = 'Service account object must contain a string "project_id" property.';
    } else if (typeof this.privateKey !== 'string' || !this.privateKey) {
      errorMessage = 'Service account object must contain a string "private_key" property.';
    } else if (typeof this.clientEmail !== 'string' || !this.clientEmail) {
      errorMessage = 'Service account object must contain a string "client_email" property.';
    }

    if (typeof errorMessage !== 'undefined') {
      throw new FirebaseAppError(AppErrorCodes.INVALID_CREDENTIAL, errorMessage);
    }

    const forge = require('node-forge');
    try {
      forge.pki.privateKeyFromPem(this.privateKey);
    } catch (error) {
      throw new FirebaseAppError(
        AppErrorCodes.INVALID_CREDENTIAL,
        'Failed to parse private key: ' + error);
    }
  }
}

/**
 * Implementation of Credential that gets access tokens from the metadata service available
 * in the Google Cloud Platform. This authenticates the process as the default service account
 * of an App Engine instance or Google Compute Engine machine.
 */
export class ComputeEngineCredential implements Credential {

  private readonly httpClient = new HttpClient();
  private readonly httpAgent?: Agent;

  constructor(httpAgent?: Agent) {
    this.httpAgent = httpAgent;
  }

  public getAccessToken(): Promise<GoogleOAuthAccessToken> {
    const request = this.buildRequest(GOOGLE_METADATA_SERVICE_TOKEN_PATH);
    return requestAccessToken(this.httpClient, request);
  }

  public getProjectId(): Promise<string> {
    const request = this.buildRequest(GOOGLE_METADATA_SERVICE_PROJECT_ID_PATH);
    return this.httpClient.send(request)
      .then((resp) => {
        return resp.text!;
      });
  }

  private buildRequest(urlPath: string): HttpRequestConfig {
    return {
      method: 'GET',
      url: `http://${GOOGLE_METADATA_SERVICE_HOST}${urlPath}`,
      headers: {
        'Metadata-Flavor': 'Google',
      },
      httpAgent: this.httpAgent,
    };
  }
}

/**
 * Implementation of Credential that gets access tokens from refresh tokens.
 */
export class RefreshTokenCredential implements Credential {

  private readonly refreshToken: RefreshToken;
  private readonly httpClient: HttpClient;
  private readonly httpAgent?: Agent;

  constructor(refreshTokenPathOrObject: string | object, httpAgent?: Agent) {
    this.refreshToken = (typeof refreshTokenPathOrObject === 'string') ?
      RefreshToken.fromPath(refreshTokenPathOrObject)
      : new RefreshToken(refreshTokenPathOrObject);
    this.httpClient = new HttpClient();
    this.httpAgent = httpAgent;
  }

  public getAccessToken(): Promise<GoogleOAuthAccessToken> {
    const postData =
      'client_id=' + this.refreshToken.clientId + '&' +
      'client_secret=' + this.refreshToken.clientSecret + '&' +
      'refresh_token=' + this.refreshToken.refreshToken + '&' +
      'grant_type=refresh_token';
    const request: HttpRequestConfig = {
      method: 'POST',
      url: `https://${REFRESH_TOKEN_HOST}${REFRESH_TOKEN_PATH}`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      data: postData,
      httpAgent: this.httpAgent,
    };
    return requestAccessToken(this.httpClient, request);
  }
}

class RefreshToken {

  public readonly clientId: string;
  public readonly clientSecret: string;
  public readonly refreshToken: string;
  public readonly type: string;

  /*
   * Tries to load a RefreshToken from a path. Throws if the path doesn't exist or the
   * data at the path is invalid.
   */
  public static fromPath(filePath: string): RefreshToken {
    // Node bug encountered in v6.x. fs.readFileSync hangs when path is a 0 or 1.
    if (typeof filePath !== 'string') {
      throw new FirebaseAppError(
        AppErrorCodes.INVALID_CREDENTIAL,
        'Failed to parse service account json file: TypeError: path must be a string',
      );
    }

    try {
      return new RefreshToken(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } catch (error) {
      // Throw a nicely formed error message if the file contents cannot be parsed
      throw new FirebaseAppError(
        AppErrorCodes.INVALID_CREDENTIAL,
        'Failed to parse refresh token file: ' + error,
      );
    }
  }

  constructor(json: object) {
    copyAttr(this, json, 'clientId', 'client_id');
    copyAttr(this, json, 'clientSecret', 'client_secret');
    copyAttr(this, json, 'refreshToken', 'refresh_token');
    copyAttr(this, json, 'type', 'type');

    let errorMessage;
    if (typeof this.clientId !== 'string' || !this.clientId) {
      errorMessage = 'Refresh token must contain a "client_id" property.';
    } else if (typeof this.clientSecret !== 'string' || !this.clientSecret) {
      errorMessage = 'Refresh token must contain a "client_secret" property.';
    } else if (typeof this.refreshToken !== 'string' || !this.refreshToken) {
      errorMessage = 'Refresh token must contain a "refresh_token" property.';
    } else if (typeof this.type !== 'string' || !this.type) {
      errorMessage = 'Refresh token must contain a "type" property.';
    }

    if (typeof errorMessage !== 'undefined') {
      throw new FirebaseAppError(AppErrorCodes.INVALID_CREDENTIAL, errorMessage);
    }
  }
}

export function getApplicationDefault(httpAgent?: Agent): Credential {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return credentialFromFile(process.env.GOOGLE_APPLICATION_CREDENTIALS, httpAgent);
  }

  // It is OK to not have this file. If it is present, it must be valid.
  if (GCLOUD_CREDENTIAL_PATH) {
    const refreshToken = readCredentialFile(GCLOUD_CREDENTIAL_PATH, true);
    if (refreshToken) {
      return new RefreshTokenCredential(refreshToken, httpAgent);
    }
  }

  return new ComputeEngineCredential(httpAgent);
}

function copyAttr(to: {[key: string]: any}, from: {[key: string]: any}, key: string, alt: string) {
  const tmp = from[key] || from[alt];
  if (typeof tmp !== 'undefined') {
    to[key] = tmp;
  }
}

/**
 * Obtain a new OAuth2 token by making a remote service call.
 */
function requestAccessToken(client: HttpClient, request: HttpRequestConfig): Promise<GoogleOAuthAccessToken> {
  return client.send(request).then((resp) => {
    const json = resp.data;
    if (!json.access_token || !json.expires_in) {
      throw new FirebaseAppError(
        AppErrorCodes.INVALID_CREDENTIAL,
        `Unexpected response while fetching access token: ${ JSON.stringify(json) }`,
      );
    }
    return json;
  }).catch((err) => {
    throw new FirebaseAppError(AppErrorCodes.INVALID_CREDENTIAL, getErrorMessage(err));
  });
}

/**
 * Constructs a human-readable error message from the given Error.
 */
function getErrorMessage(err: Error): string {
  const detail: string = (err instanceof HttpError) ? getDetailFromResponse(err.response) : err.message;
  return `Error fetching access token: ${detail}`;
}

/**
 * Extracts details from the given HTTP error response, and returns a human-readable description. If
 * the response is JSON-formatted, looks up the error and error_description fields sent by the
 * Google Auth servers. Otherwise returns the entire response payload as the error detail.
 */
function getDetailFromResponse(response: HttpResponse): string {
  if (response.isJson() && response.data.error) {
    const json = response.data;
    let detail = json.error;
    if (json.error_description) {
      detail += ' (' + json.error_description + ')';
    }
    return detail;
  }
  return response.text || 'Missing error payload';
}

function credentialFromFile(filePath: string, httpAgent?: Agent): Credential {
  const credentialsFile = readCredentialFile(filePath);
  if (typeof credentialsFile !== 'object' || credentialsFile === null) {
    throw new FirebaseAppError(
      AppErrorCodes.INVALID_CREDENTIAL,
      'Failed to parse contents of the credentials file as an object',
    );
  }

  if (credentialsFile.type === 'service_account') {
    return new ServiceAccountCredential(credentialsFile, httpAgent);
  }

  if (credentialsFile.type === 'authorized_user') {
    return new RefreshTokenCredential(credentialsFile, httpAgent);
  }

  throw new FirebaseAppError(
    AppErrorCodes.INVALID_CREDENTIAL,
    'Invalid contents in the credentials file',
  );
}

function readCredentialFile(filePath: string, ignoreMissing?: boolean): {[key: string]: any} | null {
  if (typeof filePath !== 'string') {
    throw new FirebaseAppError(
      AppErrorCodes.INVALID_CREDENTIAL,
      'Failed to parse credentials file: TypeError: path must be a string',
    );
  }

  let fileText: string;
  try {
    fileText = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (ignoreMissing) {
      return null;
    }

    throw new FirebaseAppError(
      AppErrorCodes.INVALID_CREDENTIAL,
      `Failed to read credentials from file ${filePath}: ` + error,
    );
  }

  try {
    return JSON.parse(fileText);
  } catch (error) {
    throw new FirebaseAppError(
      AppErrorCodes.INVALID_CREDENTIAL,
      'Failed to parse contents of the credentials file as an object: ' + error,
    );
  }
}
