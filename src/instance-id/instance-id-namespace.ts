import { App } from '../app/index';
import { InstanceId as TInstanceId } from './instance-id';

/**
 * Gets the {@link instanceId.InstanceId `InstanceId`} service for the
 * default app or a given app.
 *
 * `admin.instanceId()` can be called with no arguments to access the default
 * app's {@link instanceId.InstanceId `InstanceId`} service or as
 * `admin.instanceId(app)` to access the
 * {@link instanceId.InstanceId `InstanceId`} service associated with a
 * specific app.
 *
 * @example
 * ```javascript
 * // Get the Instance ID service for the default app
 * var defaultInstanceId = admin.instanceId();
 * ```
 *
 * @example
 * ```javascript
 * // Get the Instance ID service for a given app
 * var otherInstanceId = admin.instanceId(otherApp);
 *```
 *
 * @param app Optional app whose `InstanceId` service to
 *   return. If not provided, the default `InstanceId` service will be
 *   returned.
 *
 * @return The default `InstanceId` service if
 *   no app is provided or the `InstanceId` service associated with the
 *   provided app.
 */
export declare function instanceId(app?: App): instanceId.InstanceId;

/* eslint-disable @typescript-eslint/no-namespace */
export namespace instanceId {
  export type InstanceId = TInstanceId;
}
