/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.common;

import java.util.Arrays;
import java.util.List;
import javax.annotation.Nullable;

public class ArrayUtils {

  public static float[] copyArray(@Nullable float[] array) {
    return array == null ? null : Arrays.copyOf(array, array.length);
  }

  public static int[] copyListToArray(List<Integer> list) {
    int[] array = new int[list.size()];
    for (int t = 0; t < list.size(); t++) {
      array[t] = list.get(t);
    }
    return array;
  }
}
