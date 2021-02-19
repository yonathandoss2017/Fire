/*!
 * Copyright 2018 Google Inc.
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

import * as admin from '../../lib/index';
import { App, deleteApp, getApp, initializeApp } from '../../lib/app/index';
import { getAuth } from '../../lib/auth/index';
import { expect } from 'chai';
import {
  defaultApp, nullApp, nonNullApp, databaseUrl, projectId, storageBucket,
} from './setup';

describe('admin', () => {
  it('populates required test parameters', () => {
    expect(databaseUrl).to.be.not.empty;
    expect(projectId).to.be.not.empty;
    expect(storageBucket).to.be.not.empty;
  });

  describe('Dependency lazy loading', () => {
    const tempCache: {[key: string]: any} = {};
    const dependencies = ['@firebase/database', '@google-cloud/firestore'];
    let lazyLoadingApp: App;

    before(() => {
      // Unload dependencies if already loaded. Some of the other test files have imports
      // to firebase-admin/database and firebase-admin/firestore, which cause the corresponding
      // dependencies to get loaded before the tests are executed.
      dependencies.forEach((name) => {
        const resolvedName = require.resolve(name);
        tempCache[name] = require.cache[resolvedName];
        delete require.cache[resolvedName];
      });

      // Initialize the SDK
      lazyLoadingApp = initializeApp(defaultApp.options, 'lazyLoadingApp');
    });

    it('does not load RTDB by default', () => {
      const firebaseRtdb = require.cache[require.resolve('@firebase/database')];
      expect(firebaseRtdb).to.be.undefined;
    });

    it('loads RTDB when calling admin.database', () => {
      const rtdbNamespace = admin.database;
      expect(rtdbNamespace).to.not.be.null;
      const firebaseRtdb = require.cache[require.resolve('@firebase/database')];
      expect(firebaseRtdb).to.not.be.undefined;
    });

    it('does not load Firestore by default', () => {
      const gcloud = require.cache[require.resolve('@google-cloud/firestore')];
      expect(gcloud).to.be.undefined;
    });

    it('loads Firestore when calling admin.firestore', () => {
      const firestoreNamespace = admin.firestore;
      expect(firestoreNamespace).to.not.be.null;
      const gcloud = require.cache[require.resolve('@google-cloud/firestore')];
      expect(gcloud).to.not.be.undefined;
    });

    after(() => {
      dependencies.forEach((name) => {
        const resolvedName = require.resolve(name);
        require.cache[resolvedName] = tempCache[name];
      });
      return deleteApp(lazyLoadingApp);
    })
  });
});

describe('admin.app', () => {
  it('admin.app() returns the default App', () => {
    const app = admin.app();
    expect(app).to.deep.equal(defaultApp);
    expect(app.name).to.equal('[DEFAULT]');
    expect(app.options.databaseURL).to.equal(databaseUrl);
    expect(app.options.databaseAuthVariableOverride).to.be.undefined;
    expect(app.options.storageBucket).to.equal(storageBucket);
  });

  it('admin.app("null") returns the App named "null"', () => {
    const app = admin.app('null');
    expect(app).to.deep.equal(nullApp);
    expect(app.name).to.equal('null');
    expect(app.options.databaseURL).to.equal(databaseUrl);
    expect(app.options.databaseAuthVariableOverride).to.be.null;
    expect(app.options.storageBucket).to.equal(storageBucket);
  });

  it('admin.app("nonNull") returns the App named "nonNull"', () => {
    const app = admin.app('nonNull');
    expect(app).to.deep.equal(nonNullApp);
    expect(app.name).to.equal('nonNull');
    expect(app.options.databaseURL).to.equal(databaseUrl);
    expect((app.options.databaseAuthVariableOverride as any).uid).to.be.ok;
    expect(app.options.storageBucket).to.equal(storageBucket);
  });

  it('namespace services are attached to the default App', () => {
    const app = admin.app();
    expect(admin.auth(app).app).to.deep.equal(app);
    expect(admin.database(app).app).to.deep.equal(app);
    expect(admin.messaging(app).app).to.deep.equal(app);
    expect(admin.storage(app).app).to.deep.equal(app);
  });

  it('namespace services are attached to the named App', () => {
    const app = admin.app('null');
    expect(admin.auth(app).app).to.deep.equal(app);
    expect(admin.database(app).app).to.deep.equal(app);
    expect(admin.messaging(app).app).to.deep.equal(app);
    expect(admin.storage(app).app).to.deep.equal(app);
  });
});

describe('getApp', () => {
  it('getApp() returns the default App', () => {
    const app = getApp();
    expect(app).to.deep.equal(defaultApp);
    expect(app.name).to.equal('[DEFAULT]');
    expect(app.options.databaseURL).to.equal(databaseUrl);
    expect(app.options.databaseAuthVariableOverride).to.be.undefined;
    expect(app.options.storageBucket).to.equal(storageBucket);
  });

  it('getApp("null") returns the App named "null"', () => {
    const app = getApp('null');
    expect(app).to.deep.equal(nullApp);
    expect(app.name).to.equal('null');
    expect(app.options.databaseURL).to.equal(databaseUrl);
    expect(app.options.databaseAuthVariableOverride).to.be.null;
    expect(app.options.storageBucket).to.equal(storageBucket);
  });

  it('getApp("nonNull") returns the App named "nonNull"', () => {
    const app = getApp('nonNull');
    expect(app).to.deep.equal(nonNullApp);
    expect(app.name).to.equal('nonNull');
    expect(app.options.databaseURL).to.equal(databaseUrl);
    expect((app.options.databaseAuthVariableOverride as any).uid).to.be.ok;
    expect(app.options.storageBucket).to.equal(storageBucket);
  });

  it('namespace services are attached to the default App', () => {
    const app = getApp();
    expect(getAuth(app).app).to.deep.equal(app);
  });

  it('namespace services are attached to the named App', () => {
    const app = getApp('null');
    expect(getAuth(app).app).to.deep.equal(app);
  });
});
