export interface Transform2D {
  x: number;
  y: number;
  /**
   * Optional height in iso-cube wz units (1 step = HEIGHT_UNIT_PX screen-px).
   * Defaults to 0 when absent. Ignored by topDown and flat-iso renderers.
   */
  z?: number;
}
