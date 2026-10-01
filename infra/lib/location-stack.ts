import { CfnOutput, Stack, StackProps } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as location from 'aws-cdk-lib/aws-location';
import { Construct } from 'constructs';
import type { EnvironmentConfig } from '../config/environments';

export interface LocationStackProps extends StackProps {
  readonly config: EnvironmentConfig;
  /**
   * SPA origins (e.g. `https://lanewise.example.com`) allowed to load map
   * tiles in the browser (task 16.1). When given, a referer-restricted API
   * key for this map only is created; without it the SPA falls back to its
   * schematic (non-network) map.
   */
  readonly mapReferers?: readonly string[];
}

/**
 * Amazon Location Service resources (spec task 24 for tasks 16.1/16.2,
 * ADR-0002): a map for the network map and a route calculator for the
 * home-area-to-store travel-time matrix (car). Only Location resources are
 * created here; access is granted to callers through {@link grantMap} and
 * {@link grantRoutes}, scoped to these two resource ARNs.
 */
export class LocationStack extends Stack {
  public readonly mapName: string;
  public readonly mapArn: string;
  public readonly routeCalculatorName: string;
  public readonly routeCalculatorArn: string;
  /** Browser map key name (read-only map access from the SPA origins), when created. */
  public readonly mapApiKeyName?: string;

  constructor(scope: Construct, id: string, props: LocationStackProps) {
    super(scope, id, props);

    const { config } = props;

    const map = new location.CfnMap(this, 'Map', {
      mapName: `lanewise-${config.envName}-map`,
      description: 'LaneWise network map (stores, staff home areas, travel-time rings).',
      configuration: { style: config.location.mapStyle },
    });
    const calculator = new location.CfnRouteCalculator(this, 'RouteCalculator', {
      calculatorName: `lanewise-${config.envName}-routes`,
      description: 'LaneWise travel-time matrix (home area to store, car).',
      dataSource: config.location.dataSource,
    });

    this.mapName = map.mapName;
    this.mapArn = map.attrArn;
    this.routeCalculatorName = calculator.calculatorName;
    this.routeCalculatorArn = calculator.attrArn;

    if (props.mapReferers && props.mapReferers.length > 0) {
      // The SPA's network map (SCR-026) renders Amazon Location tiles with
      // MapLibre GL. The key is public by nature (it ships to browsers), so
      // it can only read THIS map's tiles/style/glyphs/sprites and only from
      // the SPA origins. Its value is written to runtime-config.json at deploy.
      const key = new location.CfnAPIKey(this, 'MapApiKey', {
        keyName: `lanewise-${config.envName}-map-key`,
        description: 'LaneWise SPA network map: read-only map access from the SPA origins.',
        noExpiry: true,
        restrictions: {
          allowActions: ['geo:GetMap*'],
          allowResources: [this.mapArn],
          allowReferers: props.mapReferers.map((origin) => `${origin}/*`),
        },
      });
      this.mapApiKeyName = key.keyName;
      new CfnOutput(this, 'MapApiKeyName', {
        value: key.keyName,
        description: 'Amazon Location API key for the SPA map (value read at deploy into runtime-config.json).',
      });
    }

    new CfnOutput(this, 'MapName', { value: this.mapName, description: 'Amazon Location map resource.' });
    new CfnOutput(this, 'RouteCalculatorName', {
      value: this.routeCalculatorName,
      description: 'Amazon Location route calculator (travel-time matrix).',
    });
  }

  /** Read map tiles, glyphs, sprites and style for this map only. */
  grantMap(grantee: iam.IGrantable): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee,
      actions: ['geo:GetMapTile', 'geo:GetMapGlyphs', 'geo:GetMapSprites', 'geo:GetMapStyleDescriptor'],
      resourceArns: [this.mapArn],
    });
  }

  /** Calculate routes / route matrices with this calculator only. */
  grantRoutes(grantee: iam.IGrantable): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee,
      actions: ['geo:CalculateRoute', 'geo:CalculateRouteMatrix'],
      resourceArns: [this.routeCalculatorArn],
    });
  }
}
