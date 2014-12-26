function animate(keyframes, time)
{
  var last = keyframes.length - 1;
  if (time <= keyframes[0][0]) return keyframes[0][1];
  if (time >= keyframes[last][0]) return keyframes[last][1];
  
  // we must have at least 2 keyframes, or it will crash
  var prev = [], next = [];
  for (var i = 0; i < keyframes[1][1].length; i++) {
    prev.push(2 * keyframes[1][1][i] - keyframes[0][1][i]);
    next.push(2 * keyframes[last][1][i] - keyframes[last-1][1][i]);
  }
  
  keyframes.unshift([0, prev]);
  keyframes.push([0, next]);
  
  var i = 1;
  while ((i <= last) && (keyframes[i][0] < time)) i++;
  
  var k0 = keyframes[i - 2];
  var k1 = keyframes[i - 1];
  var k2 = keyframes[i];
  var k3 = keyframes[i + 1];
  
  var t = (time - k1[0]) / (k2[0] - k1[0]);
  
  var h1 = 2 * t * t * t - 3 * t * t + 1;          // calculate basis function 1
  var h2 = -2 * t * t * t + 3 * t * t;              // calculate basis function 2
  var h3 = t * t * t - 2 * t * t + t;         // calculate basis function 3
  var h4 = t * t * t - t * t;
  
  for (i = 0; i < k1[1].length; i++) {
    var t1 = (k2[1][i] - k0[1][i]) / 4;
    var t2 = (k3[1][i] - k1[1][i]) / 4;
    k1[1][i] = h1 * k1[1][i] + h2 * k2[1][i] + h3 * t1 + h4 * t2;
  }
  return k1[1];
}
var scenes = [];
var start_time = 0;
var snd;
var M = Math;


function minify_context(ctx)
{
  var names = []
  for (var name in ctx) names.push(name);
  names.sort();
  
  for (var i in names)
  {
    var name = names[i]
    
    // add an underscore to shader variables, to avoid conflict with glsl-unit minification
    
    var m, newName = "";
    var re = /([A-Z0-9])[A-Z]*_?/g;
    if (name.match(/[a-z]/))
      re = /(^[a-z]|[A-Z0-9])[a-z]*/g;
    while (m = re.exec(name)) newName += m[1];
    
    
    if (newName in ctx)
    {
      var index = 2;
      while ((newName + index) in ctx) index++;
      newName = newName + index;
    }
    
    ctx[newName] = ctx[name];
    
  }
}

// export for minifcation tools

function engine_render(current_time)
{
/*
  var start_time = 0;
  for (var i = 0; i < scenes.length; i++) {
    var scene = scenes[i]
    var scene_time = current_time - start_time;
    if ((scene_time >= 0) && (scene_time < scene.duration)) {
      render_scene(scene, current_time, scene_time);
      break;
    }

    start_time += scene.duration;
  }
  */
  render_scene(scenes[1], current_time, current_time);
}

var startingTime = Date.now();
function main_loop() {
  var current_time = Date.now() - startingTime;
  engine_render(current_time);
  requestAnimationFrame(main_loop);
}

function main() {
  var body = document.body
  canvas = document.createElement("canvas");
  body.appendChild(canvas);
  body.style.margin = 0;

  canvas.width = innerWidth;
  canvas.height = innerHeight;

  gl_init();
  demo_init();
  gfx_init();

  render_scene(scenes[0], 0, 0);

  snd = new SND(SONG);
  // If you want to shut the music up comment this out and also comment
  // out the equivalent line in engine-driver.js:~100
  // snd.p();

  main_loop();
}

function editor_main() {
  canvas = document.getElementById("engine-view")
  gl_init();
}

// general naming rule: things that have offset in the name are offsets in
// an array, while things with index in the name are indices that should be
// multiplied by a stride to obtain the offset.

// ring: [[x,y,z]]
// geom: {vbo, ibo, v_stride, v_cursor, i_cursor}
// v_cursor is an index (in vertex, not an offset in the array).
// Use v_cursor * v_stride for an offset in the array.

var SEED;
function seedable_random() {
    return (SEED = (69069 * SEED + 1) & 0x7FFFFFFF) / 0x80000000;
}

// For a continuous ring of 4 points the indices are:
//    0    1
//  7 A----B 2
//    |    |
//    |    |
//  6 D----C 3
//    5    4
//
// The slice of the vbo for this ring looks like:
// [A, B, B, C, C, D, D, A]
//
// Continuous rings are what the city generator outputs, but join_rings
// takes discontinuous rings as inputs:
//
// For a discontinuous ring of 4 points the indices are:
//    0    1
//    A----B
//
//
//    C----D
//    3    2
//
// The slice of the vbo for this ring looks like:
// [A, B, C, D]

function is_path_convex(path) {
    var path_length = path.length;
    var c = vec3.create();
    var v1 = vec2.create();
    var v2 = vec2.create();
    for (var i = 0; i < path_length; ++i) {
        vec2.subtract(v1, path[(i+1)%path_length], path[i]);
        vec2.subtract(v2, path[(i+2)%path_length], path[(i+1)%path_length]);
        vec2.cross(c, v1, v2);
        if (c[2] > 0) {
            return false;
        }
    }
    return true;
}

function make_ring(path, y) {
  return path.map(function(point)
  {
    return [point[0], y, -point[1]]
  })
}

function push_vertices(to, v) {
    for (var i = 0; i<v.length; ++i) {
        for (var j = 0; j<v[i].length; ++j) {
            to.push(v[i][j]);
        }
    }
}

function join_rings(geom, r1, r2, uv_fn) {

    var e1 = vec3.create()
    var e2 = vec3.create()
    var normal = [0,0,0]
    for (var i = 0; i < r1.length; i++)
    {
      var next = (i + 1) % r1.length;
      push_vertices(geom.positions, [r1[i], r1[next], r2[next], r2[next], r2[i], r1[i]]);

      vec3.sub(e1, r2[next], r1[i]);
      vec3.sub(e2, r1[next], r1[i]);
      vec3.cross(normal, e1, e2);
      vec3.normalize(normal, normal);
      push_vertices(geom.normals, [normal, normal, normal, normal, normal, normal]);
      var head_or_tail = rand_int(2) == 1 ? 0.3 : 0.5;
      push_vertices(geom.uvs, uv_fn(vec3.length(e2), head_or_tail));
    }
}

function rand_int(max) {
    return M.floor(seedable_random() * max);
}

function mod(a, m) {
  return (a%m+m)%m;
}

// Yeah. I know.
function deep_clone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

function _vector_2d(a,b) { return vec2.subtract([], b, a) }
function _vec2_scale(v, f) { return [v[0]*f, v[1]*f] }

function normal(v) {
    var l = vec2.length(v);
    return [-v[1]/l, v[0]/l]
}

function lines_intersection_2d(a1, a2, b1, b2) {
    var det = (a1[0]-a2[0])*(b1[1]-b2[1]) - (a1[1]-a2[1])*(b1[0]-b2[0]);
    if (det*det < 0.0001) { return null }
    var a = (a1[0]*a2[1]- a1[1]*a2[0]);
    var b = (b1[0]*b2[1]- b1[1]*b2[0]);
    return [
        (a * (b1[0] - b2[0]) - b * (a1[0] - a2[0])) / det,
        (a * (b1[1] - b2[1]) - b * (a1[1] - a2[1])) / det
    ];
}

function shrink_path(path, amount, z, use_subdiv, disp) {
    var new_path = [];
    var path_length = path.length;
    var pna = vec2.create();
    var pnxa = vec2.create();
    var pnb = vec2.create();
    var pnxb = vec2.create();
    for (var i = 0; i < path_length; ++i) {
        var pa = path[mod(i-1, path_length)];
        var px = path[mod(i,   path_length)];
        var pb = path[mod(i+1, path_length)];
        use_subdiv = use_subdiv || 0;
        var displacement;
        //if(disp)
        //  console.log("on a disp=" + disp);
        displacement = disp || [0,0];
        // avoid shrinking too much
        if (vec2.distance(pa, pb) < amount*(1+pa.subdiv*use_subdiv*2)) {
            return deep_clone(path);
        }
        var pa_sub = pa.subdiv || 0;
        var px_sub = px.subdiv || 0;
        var na = _vec2_scale(normal(_vector_2d(pa, px)), amount * (1+pa_sub*use_subdiv));
        var nb = _vec2_scale(normal(_vector_2d(px, pb)), amount * (1+px_sub*use_subdiv));

        vec2.add(pna, pa, na);
        vec2.add(pnb, pb, nb);
        vec2.add(pnxa, px, na);
        vec2.add(pnxb, px, nb);

        var inter = lines_intersection_2d(pna, pnxa, pnxb, pnb );

        // If inter is null (pa, px and pb are aligned)
        inter = inter || [pnxa[0], pnxa[1]];
        inter = vec2.add(inter, inter, displacement);
        inter.subdiv = path[i].subdiv;
        new_path.push(inter);
    }

    var old_segment = vec2.create();
    var new_segment = vec2.create();
    for (var i = 0; i < path_length; ++i) {
        vec2.subtract(old_segment, path[(i+1)%path_length], path[i]);
        vec2.subtract(new_segment, new_path[(i+1)%path_length], new_path[i]);

        if (vec2.dot(old_segment, new_segment) < 0) {
            return null;
        }
    }
    return new_path;
}

function fill_convex_ring(geom, ring, uv) {
  var normal = [0, 1, 0];
  // roof top or grass
  uv = uv || [0.5, 0.95];
  for (var i = 1; i < ring.length - 1; i++) {
      push_vertices(geom.positions, [ring[0], ring[i], ring[i + 1]]);
      push_vertices(geom.normals, [normal, normal, normal]);
      push_vertices(geom.uvs, [uv, uv, uv]);
  }
}

function city_subdivision_rec(paths, num_subdivs, sub_id) {
    if (sub_id < 0) { sub_id = 0; }
    var sub_paths = [];
    for (var i in paths) {
        var sub = city_subdivision(paths[i], sub_id)
        if (!sub) {
            sub_paths.push(paths[i]);
        }
        else {
            sub_paths.push(sub[0], sub[1]);
        }
    }
    if (num_subdivs == 1) {
        return sub_paths;
    }
    return city_subdivision_rec(sub_paths, num_subdivs - 1, sub_id - 1);
}

// TODO make this show in the editor: it defines how the min size of city blocks
var MIN_PERIMETER = 260;

/*function perimeter(path) {
    var accum = 0;
    var path_length = path.length;
    for (var i = 0; i < path_length; ++i) {
        accum += vec2.distance(path[i], path[(i+1) % path_length]);
    }
    return accum;
}

function smallest_segment_length(path) {
    var smallest = 10000;
    var path_length = path.length;
    for (var i = 0; i < path_length; ++i) {
        var d = vec2.distance(path[i], path[(i+1) % path_length]);
        if (d < smallest) { smallest = d; }
    }
    return smallest;
}*/

function city_subdivision(path, sub_id) {
    var path_length = path.length;

    // a1 is the index of the point starting the first edge we'll cut.
    // b1 is the index of the point starting the second edge we'll cut.
    var a1;
    var maxd = 0;
    var perimeter = 0;
    var i; // loop index, taken out to win a few bytes
    // pick the longest segment
    for (i = 0; i < path_length; ++i) {
        var d = vec2.distance(path[i], path[(i+1)%path_length]);
        if (d > maxd) {
            maxd = d;
            a1 = i;
        }
        perimeter += d;
    }

    if (perimeter < MIN_PERIMETER) { return null; }

    var a2 = (a1+1) % path_length;
    var b1, b2;

    do {
        b1 = rand_int(path_length);
        if (a1 == b1 || a1 == b1 + 1) { continue; }

        b2 = (b1+1) % path_length;

        var f1 = 0.5 + (0.5 - M.abs(seedable_random() - 0.5)) * 0.2;
        var f2 = 0.5 + (0.5 - M.abs(seedable_random() - 0.5)) * 0.2;

        var p_a3_1 = { '0': path[a1][0]*f1 + path[a2][0]*(1.0-f1), '1': path[a1][1]*f1 + path[a2][1]*(1-f1), subdiv: sub_id};
        var p_a3_2 = { '0': path[a1][0]*f1 + path[a2][0]*(1.0-f1), '1': path[a1][1]*f1 + path[a2][1]*(1-f1), subdiv: path[a1].subdiv};
        var p_b3_1 = { '0': path[b1][0]*f2 + path[b2][0]*(1.0-f2), '1': path[b1][1]*f2 + path[b2][1]*(1-f2), subdiv: sub_id};
        var p_b3_2 = { '0': path[b1][0]*f2 + path[b2][0]*(1.0-f2), '1': path[b1][1]*f2 + path[b2][1]*(1-f2), subdiv: path[b1].subdiv};

        break;
    } while (1);

    var path1 = [p_a3_1, p_b3_2]
    for (i = b2; i != a2; i = mod((i+1), path_length)) {
        path1.push(path[i]);
    }

    var path2 = [p_b3_1, p_a3_2]
    for (i = a2; i != b2; i = mod((i+1), path_length)) {
        path2.push(path[i]);
    }

    return [path1, path2];
}

function circle_path(center, radius, n_points) {
    var path = []
    for (i = 0; i < n_points; ++i) {
        path.push([
            center[0] + -M.cos(i/n_points * 2 * M.PI) * radius,
            center[1] + M.sin(i/n_points * 2 * M.PI) * radius
        ]);
    }
    return path;
}

function plazza(path, pos, rad) {
    for (p=0; p<path.length; ++p) {
      if (vec2.distance(path[p], pos) < rad) {
        return true;
      }
    }
    return false;
}






// Testing...
// if this code below ends up in the minified export, something's wrong.

function debug_draw_path(path, color, offset_x, offset_y) {
    map_ctx.strokeStyle = color;
    for (var i in path) {
        map_ctx.beginPath();
        map_ctx.moveTo(
            (path[i][0] + offset_x + 300) / 3,
            (path[i][1] + offset_y) / 3
        );
        map_ctx.lineTo(
            (path[mod(i-1, path.length)][0] + offset_x + 300) / 3,
            (path[mod(i-1, path.length)][1] + offset_y) / 3
        );
        map_ctx.stroke();
        map_ctx.closePath();
    }
}

/*function arrays_equal(a1, a2) {
    if (a1.length != a2.length) {
        return false;
    }
    for (var i = 0; i < a1.length; ++i) {
        if (a1[i] !== a2[i]) {
            return false;
        }
    }
    return true;
}
function arrays_of_arrays_equal(a1, a2) {
    if (a1.length != a2.length) {
        return false;
    }
    for (var i = 0; i < a1.length; ++i) {
        if (!arrays_equal(a1[i], a2[i])) {
            return false;
        }
    }
    return true;
}

function test_join_rings() {
    console.log("BEGIN - test_join_rings...");
    var r1 = [
        [0,0,3],
        [1,0,3],
        [1,1,3],
        [0,1,3]
    ];
    var r2 = [
        [0,0,5],
        [1,0,5],
        [1,1,5],
        [0,1,5]
    ];

    if (!arrays_of_arrays_equal(continuous_path(r1), [
        [0,0,3],
        [1,0,3],
        [1,0,3],
        [1,1,3],
        [1,1,3],
        [0,1,3],
        [0,1,3],
        [0,0,3]
    ])) {
        console.log("test_join_rings failed: wrong continuous path");
        console.log(continuous_path(r1));
    }

    var floats_per_vertex = 8;
    var geom = {
        vbo: new Float32Array(r1.length * 4 * floats_per_vertex),
        ibo: new Uint16Array(r1.length * 6),
        v_stride: floats_per_vertex,
        v_cursor: 0, i_cursor: 0
    }

    join_rings(geom, continuous_path(r1), continuous_path(r2));
    if (!arrays_equal(geom.ibo, [
        0, 8, 9,
        0, 9, 1,
        2, 10, 11,
        2, 11, 3,
        4, 12, 13,
        4, 13, 5,
        6, 14, 15,
        6, 15, 7
    ])) {
        console.log("test_join_rings failed: wrong ibo (continuous)");
        console.log(geom.ibo);
    }

    if (!arrays_equal(geom.vbo, [
        // ring 1
        0,0,3, 0, 0, 0, 0, 0,
        1,0,3, 0, 0, 0, 0, 0,
        1,0,3, 0, 0, 0, 0, 0,
        1,1,3, 0, 0, 0, 0, 0,
        1,1,3, 0, 0, 0, 0, 0,
        0,1,3, 0, 0, 0, 0, 0,
        0,1,3, 0, 0, 0, 0, 0,
        0,0,3, 0, 0, 0, 0, 0,
        // ring 2
        0,0,5, 0, 0, 0, 0, 0,
        1,0,5, 0, 0, 0, 0, 0,
        1,0,5, 0, 0, 0, 0, 0,
        1,1,5, 0, 0, 0, 0, 0,
        1,1,5, 0, 0, 0, 0, 0,
        0,1,5, 0, 0, 0, 0, 0,
        0,1,5, 0, 0, 0, 0, 0,
        0,0,5, 0, 0, 0, 0, 0
    ])) {
        console.log("test_join_rings failed: wrong vbo (continuous)");
        console.log(geom.vbo);
    }

    // TODO: test the result of normals computation
    //compute_normals(geom, 0, 0, geom.ibo.length);
    //if (!arrays_equal(geom.vbo, [
    //    // ring 1
    //    0,0,3, 0, 0, 0, 0, 0,
    //    0,0,3, 0, 0, 0, 0, 0,
    //    1,0,3, 0, 0, 0, 0, 0,
    //    1,0,3, 0, 0, 0, 0, 0,
    //    1,1,3, 0, 0, 0, 0, 0,
    //    1,1,3, 0, 0, 0, 0, 0,
    //    0,1,3, 0, 0, 0, 0, 0,
    //    0,1,3, 0, 0, 0, 0, 0,
    //    // ring 2
    //    0,0,5, 0, 0, 0, 0, 0,
    //    0,0,5, 0, 0, 0, 0, 0,
    //    1,0,5, 0, 0, 0, 0, 0,
    //    1,0,5, 0, 0, 0, 0, 0,
    //    1,1,5, 0, 0, 0, 0, 0,
    //    1,1,5, 0, 0, 0, 0, 0,
    //    0,1,5, 0, 0, 0, 0, 0,
    //    0,1,5, 0, 0, 0, 0, 0
    //])) {
    //    console.log("test_join_rings failed: wrong normals in the vbo (continuous)");
    //}

    // ---  discontinuous paths  ---

    geom = {
        vbo: new Float32Array(r1.length * 2 * floats_per_vertex),
        ibo: new Uint16Array(r1.length * 6 / 2),
        v_stride: floats_per_vertex,
        v_cursor: 0, i_cursor: 0
    }

    join_rings(geom, r1, r2);
    if (!arrays_equal(geom.ibo, [
        0, 4, 5,
        0, 5, 1,
        2, 6, 7,
        2, 7, 3
    ])) {
        console.log("test_join_rings failed: wrong ibo (discontinuous)");
        console.log(geom.ibo);
    }

    if (!arrays_equal(geom.vbo, [
        // ring 1
        0,0,3, 0, 0, 0, 0, 0,
        1,0,3, 0, 0, 0, 0, 0,
        1,1,3, 0, 0, 0, 0, 0,
        0,1,3, 0, 0, 0, 0, 0,
        // ring 2
        0,0,5, 0, 0, 0, 0, 0,
        1,0,5, 0, 0, 0, 0, 0,
        1,1,5, 0, 0, 0, 0, 0,
        0,1,5, 0, 0, 0, 0, 0
    ])) {
        console.log("test_join_rings failed: wrong vbo (discontinuous)");
        console.log(geom.vbo);
    }

    console.log("END - test_join_rings");
}
*/
var gl
var canvas
var textures = {}
var uniforms = {}
var geometries = {}
var programs = {}
var fragment_shaders = {}
var vertex_shaders = {}
var textureCanvas
var textureContext

function gl_init() {
  gl = canvas.getContext("webgl");
  minify_context(gl);
  
  gl.viewport(0, 0, canvas.width, canvas.height);

  var buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  var quad = new Float32Array([-1, -1,
                               -1,  1,
                                1, -1,
                                1,  1]);
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
  _quad_vbo = buffer;
  // get readable strings for error enum values

  textureCanvas = document.createElement("canvas");
  textureCanvas.width = textureCanvas.height = 2048;
  textureContext = textureCanvas.getContext("2d");
  minify_context(textureContext);
  
  load_shaders();
}

function clear_texture_canvas() {
  textureContext.clearRect(0, 0, 2048, 2048);
}

var _quad_vbo = null;

var _locations = [
  "position",
  "tex_coords",
  "normals",
  "color"
];

var POS = 0;
var TEX_COORDS = 1;
var NORMALS = 2;
var COLOR = 3;



function gfx_init() {
  // replace the render passes' texture arrays by actual frame buffer objects
  // this is far from optimal...
  for (var s=0; s<scenes.length; ++s) {
    var scene = scenes[s];
    for (var p=0; p<scene.passes.length; ++p) {
      var pass = scene.passes[p];
      if (pass.render_to) {
        pass.fbo = frame_buffer(pass.render_to);
      }
    }
  }
  
  uniforms["cam_pos"] = [0, 1, 0]
  uniforms["cam_target"] = [0, 0, 0]
  uniforms["cam_fov"] = 75
  uniforms["cam_tilt"] = 0
  
  // hack to make the export toolchain minify attribute and uniform names
}

function make_vbo(location, buffer) {
  var vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(buffer), gl.STATIC_DRAW);
  return {location: location, vbo: vbo, length: buffer.length};
}

// editor only

function draw_quad() {
  gl.disable(gl.DEPTH_TEST);
  gl.bindBuffer(gl.ARRAY_BUFFER, _quad_vbo);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// actually renders
function draw_geom(data) {
  gl.enable(gl.DEPTH_TEST);
  for (var i in data.buffers) {
    var buffer = data.buffers[i];
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer.vbo);
    gl.enableVertexAttribArray(buffer.location);
    gl.vertexAttribPointer(buffer.location, buffer.length / data.vertex_count, gl.FLOAT, false, 0, 0);
  }
  gl.drawArrays(data.mode, 0, data.vertex_count);
}

// to use with the timeline
function draw_mesh(data) {
  return function() {
    draw_geom(data);
  }
}

// type: gl.VERTEX_SHADER or gl.FRAGMENT_SHADER
function compile_shader(txt_src, type) {
  var shader = gl.createShader(type);
  gl.shaderSource(shader, txt_src);
  gl.compileShader(shader);
  return shader;
}

function load_shader_program(vs_entry_point, fs_entry_point) {
  var vs = vs_shader_source.replace(vs_entry_point + "()", "main()");
  var fs = fs_shader_source.replace(fs_entry_point + "()", "main()");
  var program = gl.createProgram();
  gl.attachShader(program, compile_shader(vs, gl.VERTEX_SHADER));
  gl.attachShader(program, compile_shader(fs, gl.FRAGMENT_SHADER));

  for (var i in _locations) {
    gl.bindAttribLocation(program, i, _locations[i]);
  }

  gl.linkProgram(program);
  return program;
}

function set_texture_flags(texture, allow_repeat, linear_filtering, mipmaps) {
  // XXX - Getting the following error associated to the bind texture call:
  // WebGL: A texture is going to be rendered as if it were black, as per the
  // OpenGL ES 2.0.24 spec section 3.8.2, because it is a 2D texture, with a
  // minification filter requiring a mipmap, and is not mipmap complete (as
  // defined in section 3.7.10).
  gl.bindTexture(gl.TEXTURE_2D, texture);

  var wrap = allow_repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
  var min_filtering = linear_filtering
                    ? mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR
                    : gl.NEAREST;
  var mag_filtering = linear_filtering ? gl.LINEAR : gl.NEAREST;

  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, min_filtering);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, mag_filtering);
  if (mipmaps) {
    gl.generateMipmap(gl.TEXTURE_2D);
  }
}

function create_texture(width, height, format, data, allow_repeat, linear_filtering, mipmaps) {
  format = format || gl.RGBA;
  width = width || canvas.width;
  height = height || canvas.height;

  var texture = gl.createTexture();

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, format, width, height, 0,
                format,
                (format == gl.DEPTH_COMPONENT) ? gl.UNSIGNED_SHORT
                                               : gl.UNSIGNED_BYTE, data ? new Uint8Array(data, 0, 0)
                                                                        : null);

  set_texture_flags(texture, allow_repeat, linear_filtering, mipmaps);

  return {
    tex: texture,
    width: width,
    height: height
  };
}

function texture_unit(i) { return gl.TEXTURE0+i; }


function frame_buffer(target) {
  var fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);

  if (target.color) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.color.tex, 0);
  if (target.depth) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, target.depth.tex, 0);


  return fbo;
}

function set_uniforms(program, ratio) {
  var viewMatrix = mat4.create()
  var projectionMatrix = mat4.create()
  var viewProjectionMatrix = mat4.create()
  var viewProjectionMatrixInv = mat4.create()
  
  // derive camera matrices from simpler parameters
  //mat4.lookAt(viewMatrix, uniforms["cam_pos"], uniforms["cam_target"], [0.0, 1.0, 0.0]);
  mat4.lookAtTilt(viewMatrix, uniforms["cam_pos"], uniforms["cam_target"], uniforms["cam_tilt"]);
  mat4.perspective(projectionMatrix, uniforms["cam_fov"] * M.PI / 180.0, ratio, 2.0, 2000.0)
  mat4.multiply(viewProjectionMatrix, projectionMatrix, viewMatrix);
  mat4.invert(viewProjectionMatrixInv, viewProjectionMatrix);
  uniforms["view_proj_mat"] = viewProjectionMatrix;
  uniforms["view_proj_mat_inv"] = viewProjectionMatrixInv;
  
  for (var uniformName in uniforms) {
    var val = uniforms[uniformName];

    var location = gl.getUniformLocation(program, uniformName);
    if (!location)
      continue;

    // if val is a bare number, make a one-element array
    if (typeof val == "number")
      val = [val];

    switch (val.length) {
      case 1: gl.uniform1fv(location, val); break;
      case 2: gl.uniform2fv(location, val); break;
      case 3: gl.uniform3fv(location, val); break;
      case 4: gl.uniform4fv(location, val); break;
      case 9: gl.uniformMatrix3fv(location, 0, val); break;
      case 16: gl.uniformMatrix4fv(location, 0, val); break;
    }
  }
}

function clear() {
  gl.clearColor(0.7, 0.8, 0.9, 1.0);
  gl.clearDepth(1.0);
  gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
}

function render_scene(scene, demo_time, scene_time) {
  var clip_time_norm = scene_time/scene.duration;
  uniforms["clip_time"] = scene_time;
  var t = {
    scene_norm: clip_time_norm,
    demo: demo_time,
    scene: scene_time
  };
  if (scene.update) {
    scene.update(t);
  }
  gl.disable(gl.BLEND);
  for (var p in scene.passes) {
    var pass = scene.passes[p];
    if (pass.update) {
      pass.update(t);
    }
    if (pass.program) {
      var shader_program = pass.program;
      gl.useProgram(shader_program);
      var rx = canvas.width;
      var ry = canvas.height;
      if (pass.render_to) {
        rx = pass.render_to.color.width;
        ry = pass.render_to.color.height;
      }
      uniforms["resolution"] = [rx,ry];
      set_uniforms(shader_program, rx / ry);
      gl.viewport(0, 0, rx, ry);
    }
    if (pass.fbo) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, pass.fbo);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    if (pass.texture_inputs) {
      for (var i=0; i<pass.texture_inputs.length; ++i) {
        var tex = pass.texture_inputs[i].tex;
        gl.activeTexture(texture_unit(i));
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(gl.getUniformLocation(shader_program,"texture_"+i), i);
      }
    }
    if (pass.blend) {
      gl.enable(gl.BLEND);
      gl.blendFunc.apply(gl, pass.blend);
    }
    if (pass.render) {
      pass.render(pass.program);
    }
  }
}
/**
 * @fileoverview gl-matrix - High performance matrix and vector operations
 * @author Brandon Jones
 * @author Colin MacKenzie IV
 * @version 2.2.1
 */

/* Copyright (c) 2013, Brandon Jones, Colin MacKenzie IV. All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

  * Redistributions of source code must retain the above copyright notice, this
    list of conditions and the following disclaimer.
  * Redistributions in binary form must reproduce the above copyright notice,
    this list of conditions and the following disclaimer in the documentation
    and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. */

var GLMAT_EPSILON = 0.000001;
var GLMAT_ARRAY_TYPE = Float32Array;
var GLMAT_RANDOM = M.random;

/**
 * @class Common utilities
 * @name glMatrix
 */
var glMatrix = {};

/**
 * Sets the type of array used when creating new vectors and matricies
 *
 * @param {Type} type Array type, such as Float32Array or Array
 */
glMatrix.setMatrixArrayType = function(type) {
    GLMAT_ARRAY_TYPE = type;
}

var degree = M.PI / 180;

/**
* Convert Degree To Radian
*
* @param {Number} Angle in Degrees
*/
glMatrix.toRadian = function(a){
     return a * degree;
}
;
/* Copyright (c) 2013, Brandon Jones, Colin MacKenzie IV. All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

  * Redistributions of source code must retain the above copyright notice, this
    list of conditions and the following disclaimer.
  * Redistributions in binary form must reproduce the above copyright notice,
    this list of conditions and the following disclaimer in the documentation 
    and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE 
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. */

/**
 * @class 2 Dimensional Vector
 * @name vec2
 */

var vec2 = {};

/**
 * Creates a new, empty vec2
 *
 * @returns {vec2} a new 2D vector
 */
vec2.create = function() {
    var out = new GLMAT_ARRAY_TYPE(2);
    out[0] = 0;
    out[1] = 0;
    return out;
};

/**
 * Creates a new vec2 initialized with values from an existing vector
 *
 * @param {vec2} a vector to clone
 * @returns {vec2} a new 2D vector
 */
vec2.clone = function(a) {
    var out = new GLMAT_ARRAY_TYPE(2);
    out[0] = a[0];
    out[1] = a[1];
    return out;
};

/**
 * Creates a new vec2 initialized with the given values
 *
 * @param {Number} x X component
 * @param {Number} y Y component
 * @returns {vec2} a new 2D vector
 */
vec2.fromValues = function(x, y) {
    var out = new GLMAT_ARRAY_TYPE(2);
    out[0] = x;
    out[1] = y;
    return out;
};

/**
 * Copy the values from one vec2 to another
 *
 * @param {vec2} out the receiving vector
 * @param {vec2} a the source vector
 * @returns {vec2} out
 */
vec2.copy = function(out, a) {
    out[0] = a[0];
    out[1] = a[1];
    return out;
};

/**
 * Set the components of a vec2 to the given values
 *
 * @param {vec2} out the receiving vector
 * @param {Number} x X component
 * @param {Number} y Y component
 * @returns {vec2} out
 */
vec2.set = function(out, x, y) {
    out[0] = x;
    out[1] = y;
    return out;
};

/**
 * Adds two vec2's
 *
 * @param {vec2} out the receiving vector
 * @param {vec2} a the first operand
 * @param {vec2} b the second operand
 * @returns {vec2} out
 */
vec2.add = function(out, a, b) {
    out[0] = a[0] + b[0];
    out[1] = a[1] + b[1];
    return out;
};

/**
 * Subtracts vector b from vector a
 *
 * @param {vec2} out the receiving vector
 * @param {vec2} a the first operand
 * @param {vec2} b the second operand
 * @returns {vec2} out
 */
vec2.subtract = function(out, a, b) {
    out[0] = a[0] - b[0];
    out[1] = a[1] - b[1];
    return out;
};

/**
 * Alias for {@link vec2.subtract}
 * @function
 */
vec2.sub = vec2.subtract;

/**
 * Multiplies two vec2's
 *
 * @param {vec2} out the receiving vector
 * @param {vec2} a the first operand
 * @param {vec2} b the second operand
 * @returns {vec2} out
 */
vec2.multiply = function(out, a, b) {
    out[0] = a[0] * b[0];
    out[1] = a[1] * b[1];
    return out;
};

/**
 * Alias for {@link vec2.multiply}
 * @function
 */
vec2.mul = vec2.multiply;

/**
 * Divides two vec2's
 *
 * @param {vec2} out the receiving vector
 * @param {vec2} a the first operand
 * @param {vec2} b the second operand
 * @returns {vec2} out
 */
vec2.divide = function(out, a, b) {
    out[0] = a[0] / b[0];
    out[1] = a[1] / b[1];
    return out;
};

/**
 * Alias for {@link vec2.divide}
 * @function
 */
vec2.div = vec2.divide;

/**
 * Returns the minimum of two vec2's
 *
 * @param {vec2} out the receiving vector
 * @param {vec2} a the first operand
 * @param {vec2} b the second operand
 * @returns {vec2} out
 */
vec2.min = function(out, a, b) {
    out[0] = M.min(a[0], b[0]);
    out[1] = M.min(a[1], b[1]);
    return out;
};

/**
 * Returns the maximum of two vec2's
 *
 * @param {vec2} out the receiving vector
 * @param {vec2} a the first operand
 * @param {vec2} b the second operand
 * @returns {vec2} out
 */
vec2.max = function(out, a, b) {
    out[0] = M.max(a[0], b[0]);
    out[1] = M.max(a[1], b[1]);
    return out;
};

/**
 * Scales a vec2 by a scalar number
 *
 * @param {vec2} out the receiving vector
 * @param {vec2} a the vector to scale
 * @param {Number} b amount to scale the vector by
 * @returns {vec2} out
 */
vec2.scale = function(out, a, b) {
    out[0] = a[0] * b;
    out[1] = a[1] * b;
    return out;
};

/**
 * Adds two vec2's after scaling the second operand by a scalar value
 *
 * @param {vec2} out the receiving vector
 * @param {vec2} a the first operand
 * @param {vec2} b the second operand
 * @param {Number} scale the amount to scale b by before adding
 * @returns {vec2} out
 */
vec2.scaleAndAdd = function(out, a, b, scale) {
    out[0] = a[0] + (b[0] * scale);
    out[1] = a[1] + (b[1] * scale);
    return out;
};

/**
 * Calculates the euclidian distance between two vec2's
 *
 * @param {vec2} a the first operand
 * @param {vec2} b the second operand
 * @returns {Number} distance between a and b
 */
vec2.distance = function(a, b) {
    var x = b[0] - a[0],
        y = b[1] - a[1];
    return M.sqrt(x*x + y*y);
};

/**
 * Alias for {@link vec2.distance}
 * @function
 */
vec2.dist = vec2.distance;

/**
 * Calculates the squared euclidian distance between two vec2's
 *
 * @param {vec2} a the first operand
 * @param {vec2} b the second operand
 * @returns {Number} squared distance between a and b
 */
vec2.squaredDistance = function(a, b) {
    var x = b[0] - a[0],
        y = b[1] - a[1];
    return x*x + y*y;
};

/**
 * Alias for {@link vec2.squaredDistance}
 * @function
 */
vec2.sqrDist = vec2.squaredDistance;

/**
 * Calculates the length of a vec2
 *
 * @param {vec2} a vector to calculate length of
 * @returns {Number} length of a
 */
vec2.length = function (a) {
    var x = a[0],
        y = a[1];
    return M.sqrt(x*x + y*y);
};

/**
 * Alias for {@link vec2.length}
 * @function
 */
vec2.len = vec2.length;

/**
 * Calculates the squared length of a vec2
 *
 * @param {vec2} a vector to calculate squared length of
 * @returns {Number} squared length of a
 */
vec2.squaredLength = function (a) {
    var x = a[0],
        y = a[1];
    return x*x + y*y;
};

/**
 * Alias for {@link vec2.squaredLength}
 * @function
 */
vec2.sqrLen = vec2.squaredLength;

/**
 * Negates the components of a vec2
 *
 * @param {vec2} out the receiving vector
 * @param {vec2} a vector to negate
 * @returns {vec2} out
 */
vec2.negate = function(out, a) {
    out[0] = -a[0];
    out[1] = -a[1];
    return out;
};

/**
 * Normalize a vec2
 *
 * @param {vec2} out the receiving vector
 * @param {vec2} a vector to normalize
 * @returns {vec2} out
 */
vec2.normalize = function(out, a) {
    var x = a[0],
        y = a[1];
    var len = x*x + y*y;
    if (len > 0) {
        //TODO: evaluate use of glm_invsqrt here?
        len = 1 / M.sqrt(len);
        out[0] = a[0] * len;
        out[1] = a[1] * len;
    }
    return out;
};

/**
 * Calculates the dot product of two vec2's
 *
 * @param {vec2} a the first operand
 * @param {vec2} b the second operand
 * @returns {Number} dot product of a and b
 */
vec2.dot = function (a, b) {
    return a[0] * b[0] + a[1] * b[1];
};

/**
 * Computes the cross product of two vec2's
 * Note that the cross product must by definition produce a 3D vector
 *
 * @param {vec3} out the receiving vector
 * @param {vec2} a the first operand
 * @param {vec2} b the second operand
 * @returns {vec3} out
 */
vec2.cross = function(out, a, b) {
    var z = a[0] * b[1] - a[1] * b[0];
    out[0] = out[1] = 0;
    out[2] = z;
    return out;
};

/**
 * Performs a linear interpolation between two vec2's
 *
 * @param {vec2} out the receiving vector
 * @param {vec2} a the first operand
 * @param {vec2} b the second operand
 * @param {Number} t interpolation amount between the two inputs
 * @returns {vec2} out
 */
vec2.lerp = function (out, a, b, t) {
    var ax = a[0],
        ay = a[1];
    out[0] = ax + t * (b[0] - ax);
    out[1] = ay + t * (b[1] - ay);
    return out;
};

/**
 * Generates a random vector with the given scale
 *
 * @param {vec2} out the receiving vector
 * @param {Number} [scale] Length of the resulting vector. If ommitted, a unit vector will be returned
 * @returns {vec2} out
 */
vec2.random = function (out, scale) {
    scale = scale || 1.0;
    var r = GLMAT_RANDOM() * 2.0 * M.PI;
    out[0] = M.cos(r) * scale;
    out[1] = M.sin(r) * scale;
    return out;
};

/**
 * Transforms the vec2 with a mat2
 *
 * @param {vec2} out the receiving vector
 * @param {vec2} a the vector to transform
 * @param {mat2} m matrix to transform with
 * @returns {vec2} out
 */
vec2.transformMat2 = function(out, a, m) {
    var x = a[0],
        y = a[1];
    out[0] = m[0] * x + m[2] * y;
    out[1] = m[1] * x + m[3] * y;
    return out;
};

/**
 * Transforms the vec2 with a mat2d
 *
 * @param {vec2} out the receiving vector
 * @param {vec2} a the vector to transform
 * @param {mat2d} m matrix to transform with
 * @returns {vec2} out
 */
vec2.transformMat2d = function(out, a, m) {
    var x = a[0],
        y = a[1];
    out[0] = m[0] * x + m[2] * y + m[4];
    out[1] = m[1] * x + m[3] * y + m[5];
    return out;
};

/**
 * Transforms the vec2 with a mat3
 * 3rd vector component is implicitly '1'
 *
 * @param {vec2} out the receiving vector
 * @param {vec2} a the vector to transform
 * @param {mat3} m matrix to transform with
 * @returns {vec2} out
 */
vec2.transformMat3 = function(out, a, m) {
    var x = a[0],
        y = a[1];
    out[0] = m[0] * x + m[3] * y + m[6];
    out[1] = m[1] * x + m[4] * y + m[7];
    return out;
};

/**
 * Transforms the vec2 with a mat4
 * 3rd vector component is implicitly '0'
 * 4th vector component is implicitly '1'
 *
 * @param {vec2} out the receiving vector
 * @param {vec2} a the vector to transform
 * @param {mat4} m matrix to transform with
 * @returns {vec2} out
 */
vec2.transformMat4 = function(out, a, m) {
    var x = a[0], 
        y = a[1];
    out[0] = m[0] * x + m[4] * y + m[12];
    out[1] = m[1] * x + m[5] * y + m[13];
    return out;
};

/**
 * Perform some operation over an array of vec2s.
 *
 * @param {Array} a the array of vectors to iterate over
 * @param {Number} stride Number of elements between the start of each vec2. If 0 assumes tightly packed
 * @param {Number} offset Number of elements to skip at the beginning of the array
 * @param {Number} count Number of vec2s to iterate over. If 0 iterates over entire array
 * @param {Function} fn Function to call for each vector in the array
 * @param {Object} [arg] additional argument to pass to fn
 * @returns {Array} a
 * @function
 */
vec2.forEach = (function() {
    var vec = vec2.create();

    return function(a, stride, offset, count, fn, arg) {
        var i, l;
        if(!stride) {
            stride = 2;
        }

        if(!offset) {
            offset = 0;
        }
        
        if(count) {
            l = M.min((count * stride) + offset, a.length);
        } else {
            l = a.length;
        }

        for(i = offset; i < l; i += stride) {
            vec[0] = a[i]; vec[1] = a[i+1];
            fn(vec, vec, arg);
            a[i] = vec[0]; a[i+1] = vec[1];
        }
        
        return a;
    };
})();

/**
 * Returns a string representation of a vector
 *
 * @param {vec2} vec vector to represent as a string
 * @returns {String} string representation of the vector
 */
vec2.str = function (a) {
    return 'vec2(' + a[0] + ', ' + a[1] + ')';
};

/* Copyright (c) 2013, Brandon Jones, Colin MacKenzie IV. All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

  * Redistributions of source code must retain the above copyright notice, this
    list of conditions and the following disclaimer.
  * Redistributions in binary form must reproduce the above copyright notice,
    this list of conditions and the following disclaimer in the documentation 
    and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE 
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. */

/**
 * @class 3 Dimensional Vector
 * @name vec3
 */

var vec3 = {};

/**
 * Creates a new, empty vec3
 *
 * @returns {vec3} a new 3D vector
 */
vec3.create = function() {
    var out = new GLMAT_ARRAY_TYPE(3);
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    return out;
};

/**
 * Creates a new vec3 initialized with values from an existing vector
 *
 * @param {vec3} a vector to clone
 * @returns {vec3} a new 3D vector
 */
vec3.clone = function(a) {
    var out = new GLMAT_ARRAY_TYPE(3);
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    return out;
};

/**
 * Creates a new vec3 initialized with the given values
 *
 * @param {Number} x X component
 * @param {Number} y Y component
 * @param {Number} z Z component
 * @returns {vec3} a new 3D vector
 */
vec3.fromValues = function(x, y, z) {
    var out = new GLMAT_ARRAY_TYPE(3);
    out[0] = x;
    out[1] = y;
    out[2] = z;
    return out;
};

/**
 * Copy the values from one vec3 to another
 *
 * @param {vec3} out the receiving vector
 * @param {vec3} a the source vector
 * @returns {vec3} out
 */
vec3.copy = function(out, a) {
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    return out;
};

/**
 * Set the components of a vec3 to the given values
 *
 * @param {vec3} out the receiving vector
 * @param {Number} x X component
 * @param {Number} y Y component
 * @param {Number} z Z component
 * @returns {vec3} out
 */
vec3.set = function(out, x, y, z) {
    out[0] = x;
    out[1] = y;
    out[2] = z;
    return out;
};

/**
 * Adds two vec3's
 *
 * @param {vec3} out the receiving vector
 * @param {vec3} a the first operand
 * @param {vec3} b the second operand
 * @returns {vec3} out
 */
vec3.add = function(out, a, b) {
    out[0] = a[0] + b[0];
    out[1] = a[1] + b[1];
    out[2] = a[2] + b[2];
    return out;
};

/**
 * Subtracts vector b from vector a
 *
 * @param {vec3} out the receiving vector
 * @param {vec3} a the first operand
 * @param {vec3} b the second operand
 * @returns {vec3} out
 */
vec3.subtract = function(out, a, b) {
    out[0] = a[0] - b[0];
    out[1] = a[1] - b[1];
    out[2] = a[2] - b[2];
    return out;
};

/**
 * Alias for {@link vec3.subtract}
 * @function
 */
vec3.sub = vec3.subtract;

/**
 * Multiplies two vec3's
 *
 * @param {vec3} out the receiving vector
 * @param {vec3} a the first operand
 * @param {vec3} b the second operand
 * @returns {vec3} out
 */
vec3.multiply = function(out, a, b) {
    out[0] = a[0] * b[0];
    out[1] = a[1] * b[1];
    out[2] = a[2] * b[2];
    return out;
};

/**
 * Alias for {@link vec3.multiply}
 * @function
 */
vec3.mul = vec3.multiply;

/**
 * Divides two vec3's
 *
 * @param {vec3} out the receiving vector
 * @param {vec3} a the first operand
 * @param {vec3} b the second operand
 * @returns {vec3} out
 */
vec3.divide = function(out, a, b) {
    out[0] = a[0] / b[0];
    out[1] = a[1] / b[1];
    out[2] = a[2] / b[2];
    return out;
};

/**
 * Alias for {@link vec3.divide}
 * @function
 */
vec3.div = vec3.divide;

/**
 * Returns the minimum of two vec3's
 *
 * @param {vec3} out the receiving vector
 * @param {vec3} a the first operand
 * @param {vec3} b the second operand
 * @returns {vec3} out
 */
vec3.min = function(out, a, b) {
    out[0] = M.min(a[0], b[0]);
    out[1] = M.min(a[1], b[1]);
    out[2] = M.min(a[2], b[2]);
    return out;
};

/**
 * Returns the maximum of two vec3's
 *
 * @param {vec3} out the receiving vector
 * @param {vec3} a the first operand
 * @param {vec3} b the second operand
 * @returns {vec3} out
 */
vec3.max = function(out, a, b) {
    out[0] = M.max(a[0], b[0]);
    out[1] = M.max(a[1], b[1]);
    out[2] = M.max(a[2], b[2]);
    return out;
};

/**
 * Scales a vec3 by a scalar number
 *
 * @param {vec3} out the receiving vector
 * @param {vec3} a the vector to scale
 * @param {Number} b amount to scale the vector by
 * @returns {vec3} out
 */
vec3.scale = function(out, a, b) {
    out[0] = a[0] * b;
    out[1] = a[1] * b;
    out[2] = a[2] * b;
    return out;
};

/**
 * Adds two vec3's after scaling the second operand by a scalar value
 *
 * @param {vec3} out the receiving vector
 * @param {vec3} a the first operand
 * @param {vec3} b the second operand
 * @param {Number} scale the amount to scale b by before adding
 * @returns {vec3} out
 */
vec3.scaleAndAdd = function(out, a, b, scale) {
    out[0] = a[0] + (b[0] * scale);
    out[1] = a[1] + (b[1] * scale);
    out[2] = a[2] + (b[2] * scale);
    return out;
};

/**
 * Calculates the euclidian distance between two vec3's
 *
 * @param {vec3} a the first operand
 * @param {vec3} b the second operand
 * @returns {Number} distance between a and b
 */
vec3.distance = function(a, b) {
    var x = b[0] - a[0],
        y = b[1] - a[1],
        z = b[2] - a[2];
    return M.sqrt(x*x + y*y + z*z);
};

/**
 * Alias for {@link vec3.distance}
 * @function
 */
vec3.dist = vec3.distance;

/**
 * Calculates the squared euclidian distance between two vec3's
 *
 * @param {vec3} a the first operand
 * @param {vec3} b the second operand
 * @returns {Number} squared distance between a and b
 */
vec3.squaredDistance = function(a, b) {
    var x = b[0] - a[0],
        y = b[1] - a[1],
        z = b[2] - a[2];
    return x*x + y*y + z*z;
};

/**
 * Alias for {@link vec3.squaredDistance}
 * @function
 */
vec3.sqrDist = vec3.squaredDistance;

/**
 * Calculates the length of a vec3
 *
 * @param {vec3} a vector to calculate length of
 * @returns {Number} length of a
 */
vec3.length = function (a) {
    var x = a[0],
        y = a[1],
        z = a[2];
    return M.sqrt(x*x + y*y + z*z);
};

/**
 * Alias for {@link vec3.length}
 * @function
 */
vec3.len = vec3.length;

/**
 * Calculates the squared length of a vec3
 *
 * @param {vec3} a vector to calculate squared length of
 * @returns {Number} squared length of a
 */
vec3.squaredLength = function (a) {
    var x = a[0],
        y = a[1],
        z = a[2];
    return x*x + y*y + z*z;
};

/**
 * Alias for {@link vec3.squaredLength}
 * @function
 */
vec3.sqrLen = vec3.squaredLength;

/**
 * Negates the components of a vec3
 *
 * @param {vec3} out the receiving vector
 * @param {vec3} a vector to negate
 * @returns {vec3} out
 */
vec3.negate = function(out, a) {
    out[0] = -a[0];
    out[1] = -a[1];
    out[2] = -a[2];
    return out;
};

/**
 * Normalize a vec3
 *
 * @param {vec3} out the receiving vector
 * @param {vec3} a vector to normalize
 * @returns {vec3} out
 */
vec3.normalize = function(out, a) {
    var x = a[0],
        y = a[1],
        z = a[2];
    var len = x*x + y*y + z*z;
    if (len > 0) {
        //TODO: evaluate use of glm_invsqrt here?
        len = 1 / M.sqrt(len);
        out[0] = a[0] * len;
        out[1] = a[1] * len;
        out[2] = a[2] * len;
    }
    return out;
};

/**
 * Calculates the dot product of two vec3's
 *
 * @param {vec3} a the first operand
 * @param {vec3} b the second operand
 * @returns {Number} dot product of a and b
 */
vec3.dot = function (a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
};

/**
 * Computes the cross product of two vec3's
 *
 * @param {vec3} out the receiving vector
 * @param {vec3} a the first operand
 * @param {vec3} b the second operand
 * @returns {vec3} out
 */
vec3.cross = function(out, a, b) {
    var ax = a[0], ay = a[1], az = a[2],
        bx = b[0], by = b[1], bz = b[2];

    out[0] = ay * bz - az * by;
    out[1] = az * bx - ax * bz;
    out[2] = ax * by - ay * bx;
    return out;
};

/**
 * Performs a linear interpolation between two vec3's
 *
 * @param {vec3} out the receiving vector
 * @param {vec3} a the first operand
 * @param {vec3} b the second operand
 * @param {Number} t interpolation amount between the two inputs
 * @returns {vec3} out
 */
vec3.lerp = function (out, a, b, t) {
    var ax = a[0],
        ay = a[1],
        az = a[2];
    out[0] = ax + t * (b[0] - ax);
    out[1] = ay + t * (b[1] - ay);
    out[2] = az + t * (b[2] - az);
    return out;
};

/**
 * Generates a random vector with the given scale
 *
 * @param {vec3} out the receiving vector
 * @param {Number} [scale] Length of the resulting vector. If ommitted, a unit vector will be returned
 * @returns {vec3} out
 */
vec3.random = function (out, scale) {
    scale = scale || 1.0;

    var r = GLMAT_RANDOM() * 2.0 * M.PI;
    var z = (GLMAT_RANDOM() * 2.0) - 1.0;
    var zScale = M.sqrt(1.0-z*z) * scale;

    out[0] = M.cos(r) * zScale;
    out[1] = M.sin(r) * zScale;
    out[2] = z * scale;
    return out;
};

/**
 * Transforms the vec3 with a mat4.
 * 4th vector component is implicitly '1'
 *
 * @param {vec3} out the receiving vector
 * @param {vec3} a the vector to transform
 * @param {mat4} m matrix to transform with
 * @returns {vec3} out
 */
vec3.transformMat4 = function(out, a, m) {
    var x = a[0], y = a[1], z = a[2];
    out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    return out;
};

/**
 * Transforms the vec3 with a mat3.
 *
 * @param {vec3} out the receiving vector
 * @param {vec3} a the vector to transform
 * @param {mat4} m the 3x3 matrix to transform with
 * @returns {vec3} out
 */
vec3.transformMat3 = function(out, a, m) {
    var x = a[0], y = a[1], z = a[2];
    out[0] = x * m[0] + y * m[3] + z * m[6];
    out[1] = x * m[1] + y * m[4] + z * m[7];
    out[2] = x * m[2] + y * m[5] + z * m[8];
    return out;
};

/**
 * Transforms the vec3 with a quat
 *
 * @param {vec3} out the receiving vector
 * @param {vec3} a the vector to transform
 * @param {quat} q quaternion to transform with
 * @returns {vec3} out
 */
vec3.transformQuat = function(out, a, q) {
    // benchmarks: http://jsperf.com/quaternion-transform-vec3-implementations

    var x = a[0], y = a[1], z = a[2],
        qx = q[0], qy = q[1], qz = q[2], qw = q[3],

        // calculate quat * vec
        ix = qw * x + qy * z - qz * y,
        iy = qw * y + qz * x - qx * z,
        iz = qw * z + qx * y - qy * x,
        iw = -qx * x - qy * y - qz * z;

    // calculate result * inverse quat
    out[0] = ix * qw + iw * -qx + iy * -qz - iz * -qy;
    out[1] = iy * qw + iw * -qy + iz * -qx - ix * -qz;
    out[2] = iz * qw + iw * -qz + ix * -qy - iy * -qx;
    return out;
};

/**
* Rotate a 3D vector around the x-axis
* @param {vec3} out The receiving vec3
* @param {vec3} a The vec3 point to rotate
* @param {vec3} b The origin of the rotation
* @param {Number} c The angle of rotation
* @returns {vec3} out
*/
vec3.rotateX = function(out, a, b, c){
   var p = [], r=[];
    //Translate point to the origin
    p[0] = a[0] - b[0];
    p[1] = a[1] - b[1];
    p[2] = a[2] - b[2];

    //perform rotation
    r[0] = p[0];
    r[1] = p[1]*M.cos(c) - p[2]*M.sin(c);
    r[2] = p[1]*M.sin(c) + p[2]*M.cos(c);

    //translate to correct position
    out[0] = r[0] + b[0];
    out[1] = r[1] + b[1];
    out[2] = r[2] + b[2];

    return out;
};

/**
* Rotate a 3D vector around the y-axis
* @param {vec3} out The receiving vec3
* @param {vec3} a The vec3 point to rotate
* @param {vec3} b The origin of the rotation
* @param {Number} c The angle of rotation
* @returns {vec3} out
*/
vec3.rotateY = function(out, a, b, c){
    var p = [], r=[];
    //Translate point to the origin
    p[0] = a[0] - b[0];
    p[1] = a[1] - b[1];
    p[2] = a[2] - b[2];
  
    //perform rotation
    r[0] = p[2]*M.sin(c) + p[0]*M.cos(c);
    r[1] = p[1];
    r[2] = p[2]*M.cos(c) - p[0]*M.sin(c);
  
    //translate to correct position
    out[0] = r[0] + b[0];
    out[1] = r[1] + b[1];
    out[2] = r[2] + b[2];
  
    return out;
};

/**
* Rotate a 3D vector around the z-axis
* @param {vec3} out The receiving vec3
* @param {vec3} a The vec3 point to rotate
* @param {vec3} b The origin of the rotation
* @param {Number} c The angle of rotation
* @returns {vec3} out
*/
vec3.rotateZ = function(out, a, b, c){
    var p = [], r=[];
    //Translate point to the origin
    p[0] = a[0] - b[0];
    p[1] = a[1] - b[1];
    p[2] = a[2] - b[2];
  
    //perform rotation
    r[0] = p[0]*M.cos(c) - p[1]*M.sin(c);
    r[1] = p[0]*M.sin(c) + p[1]*M.cos(c);
    r[2] = p[2];
  
    //translate to correct position
    out[0] = r[0] + b[0];
    out[1] = r[1] + b[1];
    out[2] = r[2] + b[2];
  
    return out;
};

/**
 * Perform some operation over an array of vec3s.
 *
 * @param {Array} a the array of vectors to iterate over
 * @param {Number} stride Number of elements between the start of each vec3. If 0 assumes tightly packed
 * @param {Number} offset Number of elements to skip at the beginning of the array
 * @param {Number} count Number of vec3s to iterate over. If 0 iterates over entire array
 * @param {Function} fn Function to call for each vector in the array
 * @param {Object} [arg] additional argument to pass to fn
 * @returns {Array} a
 * @function
 */
vec3.forEach = (function() {
    var vec = vec3.create();

    return function(a, stride, offset, count, fn, arg) {
        var i, l;
        if(!stride) {
            stride = 3;
        }

        if(!offset) {
            offset = 0;
        }
        
        if(count) {
            l = M.min((count * stride) + offset, a.length);
        } else {
            l = a.length;
        }

        for(i = offset; i < l; i += stride) {
            vec[0] = a[i]; vec[1] = a[i+1]; vec[2] = a[i+2];
            fn(vec, vec, arg);
            a[i] = vec[0]; a[i+1] = vec[1]; a[i+2] = vec[2];
        }
        
        return a;
    };
})();

/**
 * Returns a string representation of a vector
 *
 * @param {vec3} vec vector to represent as a string
 * @returns {String} string representation of the vector
 */
vec3.str = function (a) {
    return 'vec3(' + a[0] + ', ' + a[1] + ', ' + a[2] + ')';
};

/* Copyright (c) 2013, Brandon Jones, Colin MacKenzie IV. All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

  * Redistributions of source code must retain the above copyright notice, this
    list of conditions and the following disclaimer.
  * Redistributions in binary form must reproduce the above copyright notice,
    this list of conditions and the following disclaimer in the documentation 
    and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE 
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. */

/**
 * @class 4 Dimensional Vector
 * @name vec4
 */

var vec4 = {};

/**
 * Creates a new, empty vec4
 *
 * @returns {vec4} a new 4D vector
 */
vec4.create = function() {
    var out = new GLMAT_ARRAY_TYPE(4);
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    return out;
};

/**
 * Creates a new vec4 initialized with values from an existing vector
 *
 * @param {vec4} a vector to clone
 * @returns {vec4} a new 4D vector
 */
vec4.clone = function(a) {
    var out = new GLMAT_ARRAY_TYPE(4);
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    out[3] = a[3];
    return out;
};

/**
 * Creates a new vec4 initialized with the given values
 *
 * @param {Number} x X component
 * @param {Number} y Y component
 * @param {Number} z Z component
 * @param {Number} w W component
 * @returns {vec4} a new 4D vector
 */
vec4.fromValues = function(x, y, z, w) {
    var out = new GLMAT_ARRAY_TYPE(4);
    out[0] = x;
    out[1] = y;
    out[2] = z;
    out[3] = w;
    return out;
};

/**
 * Copy the values from one vec4 to another
 *
 * @param {vec4} out the receiving vector
 * @param {vec4} a the source vector
 * @returns {vec4} out
 */
vec4.copy = function(out, a) {
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    out[3] = a[3];
    return out;
};

/**
 * Set the components of a vec4 to the given values
 *
 * @param {vec4} out the receiving vector
 * @param {Number} x X component
 * @param {Number} y Y component
 * @param {Number} z Z component
 * @param {Number} w W component
 * @returns {vec4} out
 */
vec4.set = function(out, x, y, z, w) {
    out[0] = x;
    out[1] = y;
    out[2] = z;
    out[3] = w;
    return out;
};

/**
 * Adds two vec4's
 *
 * @param {vec4} out the receiving vector
 * @param {vec4} a the first operand
 * @param {vec4} b the second operand
 * @returns {vec4} out
 */
vec4.add = function(out, a, b) {
    out[0] = a[0] + b[0];
    out[1] = a[1] + b[1];
    out[2] = a[2] + b[2];
    out[3] = a[3] + b[3];
    return out;
};

/**
 * Subtracts vector b from vector a
 *
 * @param {vec4} out the receiving vector
 * @param {vec4} a the first operand
 * @param {vec4} b the second operand
 * @returns {vec4} out
 */
vec4.subtract = function(out, a, b) {
    out[0] = a[0] - b[0];
    out[1] = a[1] - b[1];
    out[2] = a[2] - b[2];
    out[3] = a[3] - b[3];
    return out;
};

/**
 * Alias for {@link vec4.subtract}
 * @function
 */
vec4.sub = vec4.subtract;

/**
 * Multiplies two vec4's
 *
 * @param {vec4} out the receiving vector
 * @param {vec4} a the first operand
 * @param {vec4} b the second operand
 * @returns {vec4} out
 */
vec4.multiply = function(out, a, b) {
    out[0] = a[0] * b[0];
    out[1] = a[1] * b[1];
    out[2] = a[2] * b[2];
    out[3] = a[3] * b[3];
    return out;
};

/**
 * Alias for {@link vec4.multiply}
 * @function
 */
vec4.mul = vec4.multiply;

/**
 * Divides two vec4's
 *
 * @param {vec4} out the receiving vector
 * @param {vec4} a the first operand
 * @param {vec4} b the second operand
 * @returns {vec4} out
 */
vec4.divide = function(out, a, b) {
    out[0] = a[0] / b[0];
    out[1] = a[1] / b[1];
    out[2] = a[2] / b[2];
    out[3] = a[3] / b[3];
    return out;
};

/**
 * Alias for {@link vec4.divide}
 * @function
 */
vec4.div = vec4.divide;

/**
 * Returns the minimum of two vec4's
 *
 * @param {vec4} out the receiving vector
 * @param {vec4} a the first operand
 * @param {vec4} b the second operand
 * @returns {vec4} out
 */
vec4.min = function(out, a, b) {
    out[0] = M.min(a[0], b[0]);
    out[1] = M.min(a[1], b[1]);
    out[2] = M.min(a[2], b[2]);
    out[3] = M.min(a[3], b[3]);
    return out;
};

/**
 * Returns the maximum of two vec4's
 *
 * @param {vec4} out the receiving vector
 * @param {vec4} a the first operand
 * @param {vec4} b the second operand
 * @returns {vec4} out
 */
vec4.max = function(out, a, b) {
    out[0] = M.max(a[0], b[0]);
    out[1] = M.max(a[1], b[1]);
    out[2] = M.max(a[2], b[2]);
    out[3] = M.max(a[3], b[3]);
    return out;
};

/**
 * Scales a vec4 by a scalar number
 *
 * @param {vec4} out the receiving vector
 * @param {vec4} a the vector to scale
 * @param {Number} b amount to scale the vector by
 * @returns {vec4} out
 */
vec4.scale = function(out, a, b) {
    out[0] = a[0] * b;
    out[1] = a[1] * b;
    out[2] = a[2] * b;
    out[3] = a[3] * b;
    return out;
};

/**
 * Adds two vec4's after scaling the second operand by a scalar value
 *
 * @param {vec4} out the receiving vector
 * @param {vec4} a the first operand
 * @param {vec4} b the second operand
 * @param {Number} scale the amount to scale b by before adding
 * @returns {vec4} out
 */
vec4.scaleAndAdd = function(out, a, b, scale) {
    out[0] = a[0] + (b[0] * scale);
    out[1] = a[1] + (b[1] * scale);
    out[2] = a[2] + (b[2] * scale);
    out[3] = a[3] + (b[3] * scale);
    return out;
};

/**
 * Calculates the euclidian distance between two vec4's
 *
 * @param {vec4} a the first operand
 * @param {vec4} b the second operand
 * @returns {Number} distance between a and b
 */
vec4.distance = function(a, b) {
    var x = b[0] - a[0],
        y = b[1] - a[1],
        z = b[2] - a[2],
        w = b[3] - a[3];
    return M.sqrt(x*x + y*y + z*z + w*w);
};

/**
 * Alias for {@link vec4.distance}
 * @function
 */
vec4.dist = vec4.distance;

/**
 * Calculates the squared euclidian distance between two vec4's
 *
 * @param {vec4} a the first operand
 * @param {vec4} b the second operand
 * @returns {Number} squared distance between a and b
 */
vec4.squaredDistance = function(a, b) {
    var x = b[0] - a[0],
        y = b[1] - a[1],
        z = b[2] - a[2],
        w = b[3] - a[3];
    return x*x + y*y + z*z + w*w;
};

/**
 * Alias for {@link vec4.squaredDistance}
 * @function
 */
vec4.sqrDist = vec4.squaredDistance;

/**
 * Calculates the length of a vec4
 *
 * @param {vec4} a vector to calculate length of
 * @returns {Number} length of a
 */
vec4.length = function (a) {
    var x = a[0],
        y = a[1],
        z = a[2],
        w = a[3];
    return M.sqrt(x*x + y*y + z*z + w*w);
};

/**
 * Alias for {@link vec4.length}
 * @function
 */
vec4.len = vec4.length;

/**
 * Calculates the squared length of a vec4
 *
 * @param {vec4} a vector to calculate squared length of
 * @returns {Number} squared length of a
 */
vec4.squaredLength = function (a) {
    var x = a[0],
        y = a[1],
        z = a[2],
        w = a[3];
    return x*x + y*y + z*z + w*w;
};

/**
 * Alias for {@link vec4.squaredLength}
 * @function
 */
vec4.sqrLen = vec4.squaredLength;

/**
 * Negates the components of a vec4
 *
 * @param {vec4} out the receiving vector
 * @param {vec4} a vector to negate
 * @returns {vec4} out
 */
vec4.negate = function(out, a) {
    out[0] = -a[0];
    out[1] = -a[1];
    out[2] = -a[2];
    out[3] = -a[3];
    return out;
};

/**
 * Normalize a vec4
 *
 * @param {vec4} out the receiving vector
 * @param {vec4} a vector to normalize
 * @returns {vec4} out
 */
vec4.normalize = function(out, a) {
    var x = a[0],
        y = a[1],
        z = a[2],
        w = a[3];
    var len = x*x + y*y + z*z + w*w;
    if (len > 0) {
        len = 1 / M.sqrt(len);
        out[0] = a[0] * len;
        out[1] = a[1] * len;
        out[2] = a[2] * len;
        out[3] = a[3] * len;
    }
    return out;
};

/**
 * Calculates the dot product of two vec4's
 *
 * @param {vec4} a the first operand
 * @param {vec4} b the second operand
 * @returns {Number} dot product of a and b
 */
vec4.dot = function (a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
};

/**
 * Performs a linear interpolation between two vec4's
 *
 * @param {vec4} out the receiving vector
 * @param {vec4} a the first operand
 * @param {vec4} b the second operand
 * @param {Number} t interpolation amount between the two inputs
 * @returns {vec4} out
 */
vec4.lerp = function (out, a, b, t) {
    var ax = a[0],
        ay = a[1],
        az = a[2],
        aw = a[3];
    out[0] = ax + t * (b[0] - ax);
    out[1] = ay + t * (b[1] - ay);
    out[2] = az + t * (b[2] - az);
    out[3] = aw + t * (b[3] - aw);
    return out;
};

/**
 * Generates a random vector with the given scale
 *
 * @param {vec4} out the receiving vector
 * @param {Number} [scale] Length of the resulting vector. If ommitted, a unit vector will be returned
 * @returns {vec4} out
 */
vec4.random = function (out, scale) {
    scale = scale || 1.0;

    //TODO: This is a pretty awful way of doing this. Find something better.
    out[0] = GLMAT_RANDOM();
    out[1] = GLMAT_RANDOM();
    out[2] = GLMAT_RANDOM();
    out[3] = GLMAT_RANDOM();
    vec4.normalize(out, out);
    vec4.scale(out, out, scale);
    return out;
};

/**
 * Transforms the vec4 with a mat4.
 *
 * @param {vec4} out the receiving vector
 * @param {vec4} a the vector to transform
 * @param {mat4} m matrix to transform with
 * @returns {vec4} out
 */
vec4.transformMat4 = function(out, a, m) {
    var x = a[0], y = a[1], z = a[2], w = a[3];
    out[0] = m[0] * x + m[4] * y + m[8] * z + m[12] * w;
    out[1] = m[1] * x + m[5] * y + m[9] * z + m[13] * w;
    out[2] = m[2] * x + m[6] * y + m[10] * z + m[14] * w;
    out[3] = m[3] * x + m[7] * y + m[11] * z + m[15] * w;
    return out;
};

/**
 * Transforms the vec4 with a quat
 *
 * @param {vec4} out the receiving vector
 * @param {vec4} a the vector to transform
 * @param {quat} q quaternion to transform with
 * @returns {vec4} out
 */
vec4.transformQuat = function(out, a, q) {
    var x = a[0], y = a[1], z = a[2],
        qx = q[0], qy = q[1], qz = q[2], qw = q[3],

        // calculate quat * vec
        ix = qw * x + qy * z - qz * y,
        iy = qw * y + qz * x - qx * z,
        iz = qw * z + qx * y - qy * x,
        iw = -qx * x - qy * y - qz * z;

    // calculate result * inverse quat
    out[0] = ix * qw + iw * -qx + iy * -qz - iz * -qy;
    out[1] = iy * qw + iw * -qy + iz * -qx - ix * -qz;
    out[2] = iz * qw + iw * -qz + ix * -qy - iy * -qx;
    return out;
};

/**
 * Perform some operation over an array of vec4s.
 *
 * @param {Array} a the array of vectors to iterate over
 * @param {Number} stride Number of elements between the start of each vec4. If 0 assumes tightly packed
 * @param {Number} offset Number of elements to skip at the beginning of the array
 * @param {Number} count Number of vec2s to iterate over. If 0 iterates over entire array
 * @param {Function} fn Function to call for each vector in the array
 * @param {Object} [arg] additional argument to pass to fn
 * @returns {Array} a
 * @function
 */
vec4.forEach = (function() {
    var vec = vec4.create();

    return function(a, stride, offset, count, fn, arg) {
        var i, l;
        if(!stride) {
            stride = 4;
        }

        if(!offset) {
            offset = 0;
        }
        
        if(count) {
            l = M.min((count * stride) + offset, a.length);
        } else {
            l = a.length;
        }

        for(i = offset; i < l; i += stride) {
            vec[0] = a[i]; vec[1] = a[i+1]; vec[2] = a[i+2]; vec[3] = a[i+3];
            fn(vec, vec, arg);
            a[i] = vec[0]; a[i+1] = vec[1]; a[i+2] = vec[2]; a[i+3] = vec[3];
        }
        
        return a;
    };
})();

/**
 * Returns a string representation of a vector
 *
 * @param {vec4} vec vector to represent as a string
 * @returns {String} string representation of the vector
 */
vec4.str = function (a) {
    return 'vec4(' + a[0] + ', ' + a[1] + ', ' + a[2] + ', ' + a[3] + ')';
};

/* Copyright (c) 2013, Brandon Jones, Colin MacKenzie IV. All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

  * Redistributions of source code must retain the above copyright notice, this
    list of conditions and the following disclaimer.
  * Redistributions in binary form must reproduce the above copyright notice,
    this list of conditions and the following disclaimer in the documentation 
    and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE 
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. */

/**
 * @class 2x2 Matrix
 * @name mat2
 */

var mat2 = {};

/**
 * Creates a new identity mat2
 *
 * @returns {mat2} a new 2x2 matrix
 */
mat2.create = function() {
    var out = new GLMAT_ARRAY_TYPE(4);
    out[0] = 1;
    out[1] = 0;
    out[2] = 0;
    out[3] = 1;
    return out;
};

/**
 * Creates a new mat2 initialized with values from an existing matrix
 *
 * @param {mat2} a matrix to clone
 * @returns {mat2} a new 2x2 matrix
 */
mat2.clone = function(a) {
    var out = new GLMAT_ARRAY_TYPE(4);
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    out[3] = a[3];
    return out;
};

/**
 * Copy the values from one mat2 to another
 *
 * @param {mat2} out the receiving matrix
 * @param {mat2} a the source matrix
 * @returns {mat2} out
 */
mat2.copy = function(out, a) {
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    out[3] = a[3];
    return out;
};

/**
 * Set a mat2 to the identity matrix
 *
 * @param {mat2} out the receiving matrix
 * @returns {mat2} out
 */
mat2.identity = function(out) {
    out[0] = 1;
    out[1] = 0;
    out[2] = 0;
    out[3] = 1;
    return out;
};

/**
 * Transpose the values of a mat2
 *
 * @param {mat2} out the receiving matrix
 * @param {mat2} a the source matrix
 * @returns {mat2} out
 */
mat2.transpose = function(out, a) {
    // If we are transposing ourselves we can skip a few steps but have to cache some values
    if (out === a) {
        var a1 = a[1];
        out[1] = a[2];
        out[2] = a1;
    } else {
        out[0] = a[0];
        out[1] = a[2];
        out[2] = a[1];
        out[3] = a[3];
    }
    
    return out;
};

/**
 * Inverts a mat2
 *
 * @param {mat2} out the receiving matrix
 * @param {mat2} a the source matrix
 * @returns {mat2} out
 */
mat2.invert = function(out, a) {
    var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3],

        // Calculate the determinant
        det = a0 * a3 - a2 * a1;

    if (!det) {
        return null;
    }
    det = 1.0 / det;
    
    out[0] =  a3 * det;
    out[1] = -a1 * det;
    out[2] = -a2 * det;
    out[3] =  a0 * det;

    return out;
};

/**
 * Calculates the adjugate of a mat2
 *
 * @param {mat2} out the receiving matrix
 * @param {mat2} a the source matrix
 * @returns {mat2} out
 */
mat2.adjoint = function(out, a) {
    // Caching this value is nessecary if out == a
    var a0 = a[0];
    out[0] =  a[3];
    out[1] = -a[1];
    out[2] = -a[2];
    out[3] =  a0;

    return out;
};

/**
 * Calculates the determinant of a mat2
 *
 * @param {mat2} a the source matrix
 * @returns {Number} determinant of a
 */
mat2.determinant = function (a) {
    return a[0] * a[3] - a[2] * a[1];
};

/**
 * Multiplies two mat2's
 *
 * @param {mat2} out the receiving matrix
 * @param {mat2} a the first operand
 * @param {mat2} b the second operand
 * @returns {mat2} out
 */
mat2.multiply = function (out, a, b) {
    var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
    var b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
    out[0] = a0 * b0 + a2 * b1;
    out[1] = a1 * b0 + a3 * b1;
    out[2] = a0 * b2 + a2 * b3;
    out[3] = a1 * b2 + a3 * b3;
    return out;
};

/**
 * Alias for {@link mat2.multiply}
 * @function
 */
mat2.mul = mat2.multiply;

/**
 * Rotates a mat2 by the given angle
 *
 * @param {mat2} out the receiving matrix
 * @param {mat2} a the matrix to rotate
 * @param {Number} rad the angle to rotate the matrix by
 * @returns {mat2} out
 */
mat2.rotate = function (out, a, rad) {
    var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3],
        s = M.sin(rad),
        c = M.cos(rad);
    out[0] = a0 *  c + a2 * s;
    out[1] = a1 *  c + a3 * s;
    out[2] = a0 * -s + a2 * c;
    out[3] = a1 * -s + a3 * c;
    return out;
};

/**
 * Scales the mat2 by the dimensions in the given vec2
 *
 * @param {mat2} out the receiving matrix
 * @param {mat2} a the matrix to rotate
 * @param {vec2} v the vec2 to scale the matrix by
 * @returns {mat2} out
 **/
mat2.scale = function(out, a, v) {
    var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3],
        v0 = v[0], v1 = v[1];
    out[0] = a0 * v0;
    out[1] = a1 * v0;
    out[2] = a2 * v1;
    out[3] = a3 * v1;
    return out;
};

/**
 * Returns a string representation of a mat2
 *
 * @param {mat2} mat matrix to represent as a string
 * @returns {String} string representation of the matrix
 */
mat2.str = function (a) {
    return 'mat2(' + a[0] + ', ' + a[1] + ', ' + a[2] + ', ' + a[3] + ')';
};

/**
 * Returns Frobenius norm of a mat2
 *
 * @param {mat2} a the matrix to calculate Frobenius norm of
 * @returns {Number} Frobenius norm
 */
mat2.frob = function (a) {
    return(M.sqrt(M.pow(a[0], 2) + M.pow(a[1], 2) + M.pow(a[2], 2) + M.pow(a[3], 2)))
};

/**
 * Returns L, D and U matrices (Lower triangular, Diagonal and Upper triangular) by factorizing the input matrix
 * @param {mat2} L the lower triangular matrix 
 * @param {mat2} D the diagonal matrix 
 * @param {mat2} U the upper triangular matrix 
 * @param {mat2} a the input matrix to factorize
 */

mat2.LDU = function (L, D, U, a) { 
    L[2] = a[2]/a[0]; 
    U[0] = a[0]; 
    U[1] = a[1]; 
    U[3] = a[3] - L[2] * U[1]; 
    return [L, D, U];       
}; 

/* Copyright (c) 2013, Brandon Jones, Colin MacKenzie IV. All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

  * Redistributions of source code must retain the above copyright notice, this
    list of conditions and the following disclaimer.
  * Redistributions in binary form must reproduce the above copyright notice,
    this list of conditions and the following disclaimer in the documentation 
    and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE 
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. */

/**
 * @class 2x3 Matrix
 * @name mat2d
 * 
 * @description 
 * A mat2d contains six elements defined as:
 * <pre>
 * [a, c, tx,
 *  b, d, ty]
 * </pre>
 * This is a short form for the 3x3 matrix:
 * <pre>
 * [a, c, tx,
 *  b, d, ty,
 *  0, 0, 1]
 * </pre>
 * The last row is ignored so the array is shorter and operations are faster.
 */

var mat2d = {};

/**
 * Creates a new identity mat2d
 *
 * @returns {mat2d} a new 2x3 matrix
 */
mat2d.create = function() {
    var out = new GLMAT_ARRAY_TYPE(6);
    out[0] = 1;
    out[1] = 0;
    out[2] = 0;
    out[3] = 1;
    out[4] = 0;
    out[5] = 0;
    return out;
};

/**
 * Creates a new mat2d initialized with values from an existing matrix
 *
 * @param {mat2d} a matrix to clone
 * @returns {mat2d} a new 2x3 matrix
 */
mat2d.clone = function(a) {
    var out = new GLMAT_ARRAY_TYPE(6);
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    out[3] = a[3];
    out[4] = a[4];
    out[5] = a[5];
    return out;
};

/**
 * Copy the values from one mat2d to another
 *
 * @param {mat2d} out the receiving matrix
 * @param {mat2d} a the source matrix
 * @returns {mat2d} out
 */
mat2d.copy = function(out, a) {
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    out[3] = a[3];
    out[4] = a[4];
    out[5] = a[5];
    return out;
};

/**
 * Set a mat2d to the identity matrix
 *
 * @param {mat2d} out the receiving matrix
 * @returns {mat2d} out
 */
mat2d.identity = function(out) {
    out[0] = 1;
    out[1] = 0;
    out[2] = 0;
    out[3] = 1;
    out[4] = 0;
    out[5] = 0;
    return out;
};

/**
 * Inverts a mat2d
 *
 * @param {mat2d} out the receiving matrix
 * @param {mat2d} a the source matrix
 * @returns {mat2d} out
 */
mat2d.invert = function(out, a) {
    var aa = a[0], ab = a[1], ac = a[2], ad = a[3],
        atx = a[4], aty = a[5];

    var det = aa * ad - ab * ac;
    if(!det){
        return null;
    }
    det = 1.0 / det;

    out[0] = ad * det;
    out[1] = -ab * det;
    out[2] = -ac * det;
    out[3] = aa * det;
    out[4] = (ac * aty - ad * atx) * det;
    out[5] = (ab * atx - aa * aty) * det;
    return out;
};

/**
 * Calculates the determinant of a mat2d
 *
 * @param {mat2d} a the source matrix
 * @returns {Number} determinant of a
 */
mat2d.determinant = function (a) {
    return a[0] * a[3] - a[1] * a[2];
};

/**
 * Multiplies two mat2d's
 *
 * @param {mat2d} out the receiving matrix
 * @param {mat2d} a the first operand
 * @param {mat2d} b the second operand
 * @returns {mat2d} out
 */
mat2d.multiply = function (out, a, b) {
    var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3], a4 = a[4], a5 = a[5],
        b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3], b4 = b[4], b5 = b[5];
    out[0] = a0 * b0 + a2 * b1;
    out[1] = a1 * b0 + a3 * b1;
    out[2] = a0 * b2 + a2 * b3;
    out[3] = a1 * b2 + a3 * b3;
    out[4] = a0 * b4 + a2 * b5 + a4;
    out[5] = a1 * b4 + a3 * b5 + a5;
    return out;
};

/**
 * Alias for {@link mat2d.multiply}
 * @function
 */
mat2d.mul = mat2d.multiply;


/**
 * Rotates a mat2d by the given angle
 *
 * @param {mat2d} out the receiving matrix
 * @param {mat2d} a the matrix to rotate
 * @param {Number} rad the angle to rotate the matrix by
 * @returns {mat2d} out
 */
mat2d.rotate = function (out, a, rad) {
    var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3], a4 = a[4], a5 = a[5],
        s = M.sin(rad),
        c = M.cos(rad);
    out[0] = a0 *  c + a2 * s;
    out[1] = a1 *  c + a3 * s;
    out[2] = a0 * -s + a2 * c;
    out[3] = a1 * -s + a3 * c;
    out[4] = a4;
    out[5] = a5;
    return out;
};

/**
 * Scales the mat2d by the dimensions in the given vec2
 *
 * @param {mat2d} out the receiving matrix
 * @param {mat2d} a the matrix to translate
 * @param {vec2} v the vec2 to scale the matrix by
 * @returns {mat2d} out
 **/
mat2d.scale = function(out, a, v) {
    var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3], a4 = a[4], a5 = a[5],
        v0 = v[0], v1 = v[1];
    out[0] = a0 * v0;
    out[1] = a1 * v0;
    out[2] = a2 * v1;
    out[3] = a3 * v1;
    out[4] = a4;
    out[5] = a5;
    return out;
};

/**
 * Translates the mat2d by the dimensions in the given vec2
 *
 * @param {mat2d} out the receiving matrix
 * @param {mat2d} a the matrix to translate
 * @param {vec2} v the vec2 to translate the matrix by
 * @returns {mat2d} out
 **/
mat2d.translate = function(out, a, v) {
    var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3], a4 = a[4], a5 = a[5],
        v0 = v[0], v1 = v[1];
    out[0] = a0;
    out[1] = a1;
    out[2] = a2;
    out[3] = a3;
    out[4] = a0 * v0 + a2 * v1 + a4;
    out[5] = a1 * v0 + a3 * v1 + a5;
    return out;
};

/**
 * Returns a string representation of a mat2d
 *
 * @param {mat2d} a matrix to represent as a string
 * @returns {String} string representation of the matrix
 */
mat2d.str = function (a) {
    return 'mat2d(' + a[0] + ', ' + a[1] + ', ' + a[2] + ', ' + 
                    a[3] + ', ' + a[4] + ', ' + a[5] + ')';
};

/**
 * Returns Frobenius norm of a mat2d
 *
 * @param {mat2d} a the matrix to calculate Frobenius norm of
 * @returns {Number} Frobenius norm
 */
mat2d.frob = function (a) { 
    return(M.sqrt(M.pow(a[0], 2) + M.pow(a[1], 2) + M.pow(a[2], 2) + M.pow(a[3], 2) + M.pow(a[4], 2) + M.pow(a[5], 2) + 1))
}; 

/* Copyright (c) 2013, Brandon Jones, Colin MacKenzie IV. All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

  * Redistributions of source code must retain the above copyright notice, this
    list of conditions and the following disclaimer.
  * Redistributions in binary form must reproduce the above copyright notice,
    this list of conditions and the following disclaimer in the documentation 
    and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE 
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. */

/**
 * @class 3x3 Matrix
 * @name mat3
 */

var mat3 = {};

/**
 * Creates a new identity mat3
 *
 * @returns {mat3} a new 3x3 matrix
 */
mat3.create = function() {
    var out = new GLMAT_ARRAY_TYPE(9);
    out[0] = 1;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 1;
    out[5] = 0;
    out[6] = 0;
    out[7] = 0;
    out[8] = 1;
    return out;
};

/**
 * Copies the upper-left 3x3 values into the given mat3.
 *
 * @param {mat3} out the receiving 3x3 matrix
 * @param {mat4} a   the source 4x4 matrix
 * @returns {mat3} out
 */
mat3.fromMat4 = function(out, a) {
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    out[3] = a[4];
    out[4] = a[5];
    out[5] = a[6];
    out[6] = a[8];
    out[7] = a[9];
    out[8] = a[10];
    return out;
};

/**
 * Creates a new mat3 initialized with values from an existing matrix
 *
 * @param {mat3} a matrix to clone
 * @returns {mat3} a new 3x3 matrix
 */
mat3.clone = function(a) {
    var out = new GLMAT_ARRAY_TYPE(9);
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    out[3] = a[3];
    out[4] = a[4];
    out[5] = a[5];
    out[6] = a[6];
    out[7] = a[7];
    out[8] = a[8];
    return out;
};

/**
 * Copy the values from one mat3 to another
 *
 * @param {mat3} out the receiving matrix
 * @param {mat3} a the source matrix
 * @returns {mat3} out
 */
mat3.copy = function(out, a) {
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    out[3] = a[3];
    out[4] = a[4];
    out[5] = a[5];
    out[6] = a[6];
    out[7] = a[7];
    out[8] = a[8];
    return out;
};

/**
 * Set a mat3 to the identity matrix
 *
 * @param {mat3} out the receiving matrix
 * @returns {mat3} out
 */
mat3.identity = function(out) {
    out[0] = 1;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 1;
    out[5] = 0;
    out[6] = 0;
    out[7] = 0;
    out[8] = 1;
    return out;
};

/**
 * Transpose the values of a mat3
 *
 * @param {mat3} out the receiving matrix
 * @param {mat3} a the source matrix
 * @returns {mat3} out
 */
mat3.transpose = function(out, a) {
    // If we are transposing ourselves we can skip a few steps but have to cache some values
    if (out === a) {
        var a01 = a[1], a02 = a[2], a12 = a[5];
        out[1] = a[3];
        out[2] = a[6];
        out[3] = a01;
        out[5] = a[7];
        out[6] = a02;
        out[7] = a12;
    } else {
        out[0] = a[0];
        out[1] = a[3];
        out[2] = a[6];
        out[3] = a[1];
        out[4] = a[4];
        out[5] = a[7];
        out[6] = a[2];
        out[7] = a[5];
        out[8] = a[8];
    }
    
    return out;
};

/**
 * Inverts a mat3
 *
 * @param {mat3} out the receiving matrix
 * @param {mat3} a the source matrix
 * @returns {mat3} out
 */
mat3.invert = function(out, a) {
    var a00 = a[0], a01 = a[1], a02 = a[2],
        a10 = a[3], a11 = a[4], a12 = a[5],
        a20 = a[6], a21 = a[7], a22 = a[8],

        b01 = a22 * a11 - a12 * a21,
        b11 = -a22 * a10 + a12 * a20,
        b21 = a21 * a10 - a11 * a20,

        // Calculate the determinant
        det = a00 * b01 + a01 * b11 + a02 * b21;

    if (!det) { 
        return null; 
    }
    det = 1.0 / det;

    out[0] = b01 * det;
    out[1] = (-a22 * a01 + a02 * a21) * det;
    out[2] = (a12 * a01 - a02 * a11) * det;
    out[3] = b11 * det;
    out[4] = (a22 * a00 - a02 * a20) * det;
    out[5] = (-a12 * a00 + a02 * a10) * det;
    out[6] = b21 * det;
    out[7] = (-a21 * a00 + a01 * a20) * det;
    out[8] = (a11 * a00 - a01 * a10) * det;
    return out;
};

/**
 * Calculates the adjugate of a mat3
 *
 * @param {mat3} out the receiving matrix
 * @param {mat3} a the source matrix
 * @returns {mat3} out
 */
mat3.adjoint = function(out, a) {
    var a00 = a[0], a01 = a[1], a02 = a[2],
        a10 = a[3], a11 = a[4], a12 = a[5],
        a20 = a[6], a21 = a[7], a22 = a[8];

    out[0] = (a11 * a22 - a12 * a21);
    out[1] = (a02 * a21 - a01 * a22);
    out[2] = (a01 * a12 - a02 * a11);
    out[3] = (a12 * a20 - a10 * a22);
    out[4] = (a00 * a22 - a02 * a20);
    out[5] = (a02 * a10 - a00 * a12);
    out[6] = (a10 * a21 - a11 * a20);
    out[7] = (a01 * a20 - a00 * a21);
    out[8] = (a00 * a11 - a01 * a10);
    return out;
};

/**
 * Calculates the determinant of a mat3
 *
 * @param {mat3} a the source matrix
 * @returns {Number} determinant of a
 */
mat3.determinant = function (a) {
    var a00 = a[0], a01 = a[1], a02 = a[2],
        a10 = a[3], a11 = a[4], a12 = a[5],
        a20 = a[6], a21 = a[7], a22 = a[8];

    return a00 * (a22 * a11 - a12 * a21) + a01 * (-a22 * a10 + a12 * a20) + a02 * (a21 * a10 - a11 * a20);
};

/**
 * Multiplies two mat3's
 *
 * @param {mat3} out the receiving matrix
 * @param {mat3} a the first operand
 * @param {mat3} b the second operand
 * @returns {mat3} out
 */
mat3.multiply = function (out, a, b) {
    var a00 = a[0], a01 = a[1], a02 = a[2],
        a10 = a[3], a11 = a[4], a12 = a[5],
        a20 = a[6], a21 = a[7], a22 = a[8],

        b00 = b[0], b01 = b[1], b02 = b[2],
        b10 = b[3], b11 = b[4], b12 = b[5],
        b20 = b[6], b21 = b[7], b22 = b[8];

    out[0] = b00 * a00 + b01 * a10 + b02 * a20;
    out[1] = b00 * a01 + b01 * a11 + b02 * a21;
    out[2] = b00 * a02 + b01 * a12 + b02 * a22;

    out[3] = b10 * a00 + b11 * a10 + b12 * a20;
    out[4] = b10 * a01 + b11 * a11 + b12 * a21;
    out[5] = b10 * a02 + b11 * a12 + b12 * a22;

    out[6] = b20 * a00 + b21 * a10 + b22 * a20;
    out[7] = b20 * a01 + b21 * a11 + b22 * a21;
    out[8] = b20 * a02 + b21 * a12 + b22 * a22;
    return out;
};

/**
 * Alias for {@link mat3.multiply}
 * @function
 */
mat3.mul = mat3.multiply;

/**
 * Translate a mat3 by the given vector
 *
 * @param {mat3} out the receiving matrix
 * @param {mat3} a the matrix to translate
 * @param {vec2} v vector to translate by
 * @returns {mat3} out
 */
mat3.translate = function(out, a, v) {
    var a00 = a[0], a01 = a[1], a02 = a[2],
        a10 = a[3], a11 = a[4], a12 = a[5],
        a20 = a[6], a21 = a[7], a22 = a[8],
        x = v[0], y = v[1];

    out[0] = a00;
    out[1] = a01;
    out[2] = a02;

    out[3] = a10;
    out[4] = a11;
    out[5] = a12;

    out[6] = x * a00 + y * a10 + a20;
    out[7] = x * a01 + y * a11 + a21;
    out[8] = x * a02 + y * a12 + a22;
    return out;
};

/**
 * Rotates a mat3 by the given angle
 *
 * @param {mat3} out the receiving matrix
 * @param {mat3} a the matrix to rotate
 * @param {Number} rad the angle to rotate the matrix by
 * @returns {mat3} out
 */
mat3.rotate = function (out, a, rad) {
    var a00 = a[0], a01 = a[1], a02 = a[2],
        a10 = a[3], a11 = a[4], a12 = a[5],
        a20 = a[6], a21 = a[7], a22 = a[8],

        s = M.sin(rad),
        c = M.cos(rad);

    out[0] = c * a00 + s * a10;
    out[1] = c * a01 + s * a11;
    out[2] = c * a02 + s * a12;

    out[3] = c * a10 - s * a00;
    out[4] = c * a11 - s * a01;
    out[5] = c * a12 - s * a02;

    out[6] = a20;
    out[7] = a21;
    out[8] = a22;
    return out;
};

/**
 * Scales the mat3 by the dimensions in the given vec2
 *
 * @param {mat3} out the receiving matrix
 * @param {mat3} a the matrix to rotate
 * @param {vec2} v the vec2 to scale the matrix by
 * @returns {mat3} out
 **/
mat3.scale = function(out, a, v) {
    var x = v[0], y = v[1];

    out[0] = x * a[0];
    out[1] = x * a[1];
    out[2] = x * a[2];

    out[3] = y * a[3];
    out[4] = y * a[4];
    out[5] = y * a[5];

    out[6] = a[6];
    out[7] = a[7];
    out[8] = a[8];
    return out;
};

/**
 * Copies the values from a mat2d into a mat3
 *
 * @param {mat3} out the receiving matrix
 * @param {mat2d} a the matrix to copy
 * @returns {mat3} out
 **/
mat3.fromMat2d = function(out, a) {
    out[0] = a[0];
    out[1] = a[1];
    out[2] = 0;

    out[3] = a[2];
    out[4] = a[3];
    out[5] = 0;

    out[6] = a[4];
    out[7] = a[5];
    out[8] = 1;
    return out;
};

/**
* Calculates a 3x3 matrix from the given quaternion
*
* @param {mat3} out mat3 receiving operation result
* @param {quat} q Quaternion to create matrix from
*
* @returns {mat3} out
*/
mat3.fromQuat = function (out, q) {
    var x = q[0], y = q[1], z = q[2], w = q[3],
        x2 = x + x,
        y2 = y + y,
        z2 = z + z,

        xx = x * x2,
        yx = y * x2,
        yy = y * y2,
        zx = z * x2,
        zy = z * y2,
        zz = z * z2,
        wx = w * x2,
        wy = w * y2,
        wz = w * z2;

    out[0] = 1 - yy - zz;
    out[3] = yx - wz;
    out[6] = zx + wy;

    out[1] = yx + wz;
    out[4] = 1 - xx - zz;
    out[7] = zy - wx;

    out[2] = zx - wy;
    out[5] = zy + wx;
    out[8] = 1 - xx - yy;

    return out;
};

/**
* Calculates a 3x3 normal matrix (transpose inverse) from the 4x4 matrix
*
* @param {mat3} out mat3 receiving operation result
* @param {mat4} a Mat4 to derive the normal matrix from
*
* @returns {mat3} out
*/
mat3.normalFromMat4 = function (out, a) {
    var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3],
        a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
        a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11],
        a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15],

        b00 = a00 * a11 - a01 * a10,
        b01 = a00 * a12 - a02 * a10,
        b02 = a00 * a13 - a03 * a10,
        b03 = a01 * a12 - a02 * a11,
        b04 = a01 * a13 - a03 * a11,
        b05 = a02 * a13 - a03 * a12,
        b06 = a20 * a31 - a21 * a30,
        b07 = a20 * a32 - a22 * a30,
        b08 = a20 * a33 - a23 * a30,
        b09 = a21 * a32 - a22 * a31,
        b10 = a21 * a33 - a23 * a31,
        b11 = a22 * a33 - a23 * a32,

        // Calculate the determinant
        det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;

    if (!det) { 
        return null; 
    }
    det = 1.0 / det;

    out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    out[1] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    out[2] = (a10 * b10 - a11 * b08 + a13 * b06) * det;

    out[3] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    out[4] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    out[5] = (a01 * b08 - a00 * b10 - a03 * b06) * det;

    out[6] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    out[7] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    out[8] = (a30 * b04 - a31 * b02 + a33 * b00) * det;

    return out;
};

/**
 * Returns a string representation of a mat3
 *
 * @param {mat3} mat matrix to represent as a string
 * @returns {String} string representation of the matrix
 */
mat3.str = function (a) {
    return 'mat3(' + a[0] + ', ' + a[1] + ', ' + a[2] + ', ' + 
                    a[3] + ', ' + a[4] + ', ' + a[5] + ', ' + 
                    a[6] + ', ' + a[7] + ', ' + a[8] + ')';
};

/**
 * Returns Frobenius norm of a mat3
 *
 * @param {mat3} a the matrix to calculate Frobenius norm of
 * @returns {Number} Frobenius norm
 */
mat3.frob = function (a) {
    return(M.sqrt(M.pow(a[0], 2) + M.pow(a[1], 2) + M.pow(a[2], 2) + M.pow(a[3], 2) + M.pow(a[4], 2) + M.pow(a[5], 2) + M.pow(a[6], 2) + M.pow(a[7], 2) + M.pow(a[8], 2)))
};


/* Copyright (c) 2013, Brandon Jones, Colin MacKenzie IV. All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

  * Redistributions of source code must retain the above copyright notice, this
    list of conditions and the following disclaimer.
  * Redistributions in binary form must reproduce the above copyright notice,
    this list of conditions and the following disclaimer in the documentation 
    and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE 
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. */

/**
 * @class 4x4 Matrix
 * @name mat4
 */

var mat4 = {};

/**
 * Creates a new identity mat4
 *
 * @returns {mat4} a new 4x4 matrix
 */
mat4.create = function() {
    var out = new GLMAT_ARRAY_TYPE(16);
    out[0] = 1;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = 1;
    out[6] = 0;
    out[7] = 0;
    out[8] = 0;
    out[9] = 0;
    out[10] = 1;
    out[11] = 0;
    out[12] = 0;
    out[13] = 0;
    out[14] = 0;
    out[15] = 1;
    return out;
};

/**
 * Creates a new mat4 initialized with values from an existing matrix
 *
 * @param {mat4} a matrix to clone
 * @returns {mat4} a new 4x4 matrix
 */
mat4.clone = function(a) {
    var out = new GLMAT_ARRAY_TYPE(16);
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    out[3] = a[3];
    out[4] = a[4];
    out[5] = a[5];
    out[6] = a[6];
    out[7] = a[7];
    out[8] = a[8];
    out[9] = a[9];
    out[10] = a[10];
    out[11] = a[11];
    out[12] = a[12];
    out[13] = a[13];
    out[14] = a[14];
    out[15] = a[15];
    return out;
};

/**
 * Copy the values from one mat4 to another
 *
 * @param {mat4} out the receiving matrix
 * @param {mat4} a the source matrix
 * @returns {mat4} out
 */
mat4.copy = function(out, a) {
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    out[3] = a[3];
    out[4] = a[4];
    out[5] = a[5];
    out[6] = a[6];
    out[7] = a[7];
    out[8] = a[8];
    out[9] = a[9];
    out[10] = a[10];
    out[11] = a[11];
    out[12] = a[12];
    out[13] = a[13];
    out[14] = a[14];
    out[15] = a[15];
    return out;
};

/**
 * Set a mat4 to the identity matrix
 *
 * @param {mat4} out the receiving matrix
 * @returns {mat4} out
 */
mat4.identity = function(out) {
    out[0] = 1;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = 1;
    out[6] = 0;
    out[7] = 0;
    out[8] = 0;
    out[9] = 0;
    out[10] = 1;
    out[11] = 0;
    out[12] = 0;
    out[13] = 0;
    out[14] = 0;
    out[15] = 1;
    return out;
};

/**
 * Transpose the values of a mat4
 *
 * @param {mat4} out the receiving matrix
 * @param {mat4} a the source matrix
 * @returns {mat4} out
 */
mat4.transpose = function(out, a) {
    // If we are transposing ourselves we can skip a few steps but have to cache some values
    if (out === a) {
        var a01 = a[1], a02 = a[2], a03 = a[3],
            a12 = a[6], a13 = a[7],
            a23 = a[11];

        out[1] = a[4];
        out[2] = a[8];
        out[3] = a[12];
        out[4] = a01;
        out[6] = a[9];
        out[7] = a[13];
        out[8] = a02;
        out[9] = a12;
        out[11] = a[14];
        out[12] = a03;
        out[13] = a13;
        out[14] = a23;
    } else {
        out[0] = a[0];
        out[1] = a[4];
        out[2] = a[8];
        out[3] = a[12];
        out[4] = a[1];
        out[5] = a[5];
        out[6] = a[9];
        out[7] = a[13];
        out[8] = a[2];
        out[9] = a[6];
        out[10] = a[10];
        out[11] = a[14];
        out[12] = a[3];
        out[13] = a[7];
        out[14] = a[11];
        out[15] = a[15];
    }
    
    return out;
};

/**
 * Inverts a mat4
 *
 * @param {mat4} out the receiving matrix
 * @param {mat4} a the source matrix
 * @returns {mat4} out
 */
mat4.invert = function(out, a) {
    var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3],
        a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
        a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11],
        a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15],

        b00 = a00 * a11 - a01 * a10,
        b01 = a00 * a12 - a02 * a10,
        b02 = a00 * a13 - a03 * a10,
        b03 = a01 * a12 - a02 * a11,
        b04 = a01 * a13 - a03 * a11,
        b05 = a02 * a13 - a03 * a12,
        b06 = a20 * a31 - a21 * a30,
        b07 = a20 * a32 - a22 * a30,
        b08 = a20 * a33 - a23 * a30,
        b09 = a21 * a32 - a22 * a31,
        b10 = a21 * a33 - a23 * a31,
        b11 = a22 * a33 - a23 * a32,

        // Calculate the determinant
        det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;

    if (!det) { 
        return null; 
    }
    det = 1.0 / det;

    out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;

    return out;
};

/**
 * Calculates the adjugate of a mat4
 *
 * @param {mat4} out the receiving matrix
 * @param {mat4} a the source matrix
 * @returns {mat4} out
 */
mat4.adjoint = function(out, a) {
    var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3],
        a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
        a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11],
        a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

    out[0]  =  (a11 * (a22 * a33 - a23 * a32) - a21 * (a12 * a33 - a13 * a32) + a31 * (a12 * a23 - a13 * a22));
    out[1]  = -(a01 * (a22 * a33 - a23 * a32) - a21 * (a02 * a33 - a03 * a32) + a31 * (a02 * a23 - a03 * a22));
    out[2]  =  (a01 * (a12 * a33 - a13 * a32) - a11 * (a02 * a33 - a03 * a32) + a31 * (a02 * a13 - a03 * a12));
    out[3]  = -(a01 * (a12 * a23 - a13 * a22) - a11 * (a02 * a23 - a03 * a22) + a21 * (a02 * a13 - a03 * a12));
    out[4]  = -(a10 * (a22 * a33 - a23 * a32) - a20 * (a12 * a33 - a13 * a32) + a30 * (a12 * a23 - a13 * a22));
    out[5]  =  (a00 * (a22 * a33 - a23 * a32) - a20 * (a02 * a33 - a03 * a32) + a30 * (a02 * a23 - a03 * a22));
    out[6]  = -(a00 * (a12 * a33 - a13 * a32) - a10 * (a02 * a33 - a03 * a32) + a30 * (a02 * a13 - a03 * a12));
    out[7]  =  (a00 * (a12 * a23 - a13 * a22) - a10 * (a02 * a23 - a03 * a22) + a20 * (a02 * a13 - a03 * a12));
    out[8]  =  (a10 * (a21 * a33 - a23 * a31) - a20 * (a11 * a33 - a13 * a31) + a30 * (a11 * a23 - a13 * a21));
    out[9]  = -(a00 * (a21 * a33 - a23 * a31) - a20 * (a01 * a33 - a03 * a31) + a30 * (a01 * a23 - a03 * a21));
    out[10] =  (a00 * (a11 * a33 - a13 * a31) - a10 * (a01 * a33 - a03 * a31) + a30 * (a01 * a13 - a03 * a11));
    out[11] = -(a00 * (a11 * a23 - a13 * a21) - a10 * (a01 * a23 - a03 * a21) + a20 * (a01 * a13 - a03 * a11));
    out[12] = -(a10 * (a21 * a32 - a22 * a31) - a20 * (a11 * a32 - a12 * a31) + a30 * (a11 * a22 - a12 * a21));
    out[13] =  (a00 * (a21 * a32 - a22 * a31) - a20 * (a01 * a32 - a02 * a31) + a30 * (a01 * a22 - a02 * a21));
    out[14] = -(a00 * (a11 * a32 - a12 * a31) - a10 * (a01 * a32 - a02 * a31) + a30 * (a01 * a12 - a02 * a11));
    out[15] =  (a00 * (a11 * a22 - a12 * a21) - a10 * (a01 * a22 - a02 * a21) + a20 * (a01 * a12 - a02 * a11));
    return out;
};

/**
 * Calculates the determinant of a mat4
 *
 * @param {mat4} a the source matrix
 * @returns {Number} determinant of a
 */
mat4.determinant = function (a) {
    var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3],
        a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
        a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11],
        a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15],

        b00 = a00 * a11 - a01 * a10,
        b01 = a00 * a12 - a02 * a10,
        b02 = a00 * a13 - a03 * a10,
        b03 = a01 * a12 - a02 * a11,
        b04 = a01 * a13 - a03 * a11,
        b05 = a02 * a13 - a03 * a12,
        b06 = a20 * a31 - a21 * a30,
        b07 = a20 * a32 - a22 * a30,
        b08 = a20 * a33 - a23 * a30,
        b09 = a21 * a32 - a22 * a31,
        b10 = a21 * a33 - a23 * a31,
        b11 = a22 * a33 - a23 * a32;

    // Calculate the determinant
    return b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
};

/**
 * Multiplies two mat4's
 *
 * @param {mat4} out the receiving matrix
 * @param {mat4} a the first operand
 * @param {mat4} b the second operand
 * @returns {mat4} out
 */
mat4.multiply = function (out, a, b) {
    var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3],
        a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
        a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11],
        a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

    // Cache only the current line of the second matrix
    var b0  = b[0], b1 = b[1], b2 = b[2], b3 = b[3];  
    out[0] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
    out[1] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
    out[2] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
    out[3] = b0*a03 + b1*a13 + b2*a23 + b3*a33;

    b0 = b[4]; b1 = b[5]; b2 = b[6]; b3 = b[7];
    out[4] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
    out[5] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
    out[6] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
    out[7] = b0*a03 + b1*a13 + b2*a23 + b3*a33;

    b0 = b[8]; b1 = b[9]; b2 = b[10]; b3 = b[11];
    out[8] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
    out[9] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
    out[10] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
    out[11] = b0*a03 + b1*a13 + b2*a23 + b3*a33;

    b0 = b[12]; b1 = b[13]; b2 = b[14]; b3 = b[15];
    out[12] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
    out[13] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
    out[14] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
    out[15] = b0*a03 + b1*a13 + b2*a23 + b3*a33;
    return out;
};

/**
 * Alias for {@link mat4.multiply}
 * @function
 */
mat4.mul = mat4.multiply;

/**
 * Translate a mat4 by the given vector
 *
 * @param {mat4} out the receiving matrix
 * @param {mat4} a the matrix to translate
 * @param {vec3} v vector to translate by
 * @returns {mat4} out
 */
mat4.translate = function (out, a, v) {
    var x = v[0], y = v[1], z = v[2],
        a00, a01, a02, a03,
        a10, a11, a12, a13,
        a20, a21, a22, a23;

    if (a === out) {
        out[12] = a[0] * x + a[4] * y + a[8] * z + a[12];
        out[13] = a[1] * x + a[5] * y + a[9] * z + a[13];
        out[14] = a[2] * x + a[6] * y + a[10] * z + a[14];
        out[15] = a[3] * x + a[7] * y + a[11] * z + a[15];
    } else {
        a00 = a[0]; a01 = a[1]; a02 = a[2]; a03 = a[3];
        a10 = a[4]; a11 = a[5]; a12 = a[6]; a13 = a[7];
        a20 = a[8]; a21 = a[9]; a22 = a[10]; a23 = a[11];

        out[0] = a00; out[1] = a01; out[2] = a02; out[3] = a03;
        out[4] = a10; out[5] = a11; out[6] = a12; out[7] = a13;
        out[8] = a20; out[9] = a21; out[10] = a22; out[11] = a23;

        out[12] = a00 * x + a10 * y + a20 * z + a[12];
        out[13] = a01 * x + a11 * y + a21 * z + a[13];
        out[14] = a02 * x + a12 * y + a22 * z + a[14];
        out[15] = a03 * x + a13 * y + a23 * z + a[15];
    }

    return out;
};

/**
 * Scales the mat4 by the dimensions in the given vec3
 *
 * @param {mat4} out the receiving matrix
 * @param {mat4} a the matrix to scale
 * @param {vec3} v the vec3 to scale the matrix by
 * @returns {mat4} out
 **/
mat4.scale = function(out, a, v) {
    var x = v[0], y = v[1], z = v[2];

    out[0] = a[0] * x;
    out[1] = a[1] * x;
    out[2] = a[2] * x;
    out[3] = a[3] * x;
    out[4] = a[4] * y;
    out[5] = a[5] * y;
    out[6] = a[6] * y;
    out[7] = a[7] * y;
    out[8] = a[8] * z;
    out[9] = a[9] * z;
    out[10] = a[10] * z;
    out[11] = a[11] * z;
    out[12] = a[12];
    out[13] = a[13];
    out[14] = a[14];
    out[15] = a[15];
    return out;
};

/**
 * Rotates a mat4 by the given angle
 *
 * @param {mat4} out the receiving matrix
 * @param {mat4} a the matrix to rotate
 * @param {Number} rad the angle to rotate the matrix by
 * @param {vec3} axis the axis to rotate around
 * @returns {mat4} out
 */
mat4.rotate = function (out, a, rad, axis) {
    var x = axis[0], y = axis[1], z = axis[2],
        len = M.sqrt(x * x + y * y + z * z),
        s, c, t,
        a00, a01, a02, a03,
        a10, a11, a12, a13,
        a20, a21, a22, a23,
        b00, b01, b02,
        b10, b11, b12,
        b20, b21, b22;

    if (M.abs(len) < GLMAT_EPSILON) { return null; }
    
    len = 1 / len;
    x *= len;
    y *= len;
    z *= len;

    s = M.sin(rad);
    c = M.cos(rad);
    t = 1 - c;

    a00 = a[0]; a01 = a[1]; a02 = a[2]; a03 = a[3];
    a10 = a[4]; a11 = a[5]; a12 = a[6]; a13 = a[7];
    a20 = a[8]; a21 = a[9]; a22 = a[10]; a23 = a[11];

    // Construct the elements of the rotation matrix
    b00 = x * x * t + c; b01 = y * x * t + z * s; b02 = z * x * t - y * s;
    b10 = x * y * t - z * s; b11 = y * y * t + c; b12 = z * y * t + x * s;
    b20 = x * z * t + y * s; b21 = y * z * t - x * s; b22 = z * z * t + c;

    // Perform rotation-specific matrix multiplication
    out[0] = a00 * b00 + a10 * b01 + a20 * b02;
    out[1] = a01 * b00 + a11 * b01 + a21 * b02;
    out[2] = a02 * b00 + a12 * b01 + a22 * b02;
    out[3] = a03 * b00 + a13 * b01 + a23 * b02;
    out[4] = a00 * b10 + a10 * b11 + a20 * b12;
    out[5] = a01 * b10 + a11 * b11 + a21 * b12;
    out[6] = a02 * b10 + a12 * b11 + a22 * b12;
    out[7] = a03 * b10 + a13 * b11 + a23 * b12;
    out[8] = a00 * b20 + a10 * b21 + a20 * b22;
    out[9] = a01 * b20 + a11 * b21 + a21 * b22;
    out[10] = a02 * b20 + a12 * b21 + a22 * b22;
    out[11] = a03 * b20 + a13 * b21 + a23 * b22;

    if (a !== out) { // If the source and destination differ, copy the unchanged last row
        out[12] = a[12];
        out[13] = a[13];
        out[14] = a[14];
        out[15] = a[15];
    }
    return out;
};

/**
 * Rotates a matrix by the given angle around the X axis
 *
 * @param {mat4} out the receiving matrix
 * @param {mat4} a the matrix to rotate
 * @param {Number} rad the angle to rotate the matrix by
 * @returns {mat4} out
 */
mat4.rotateX = function (out, a, rad) {
    var s = M.sin(rad),
        c = M.cos(rad),
        a10 = a[4],
        a11 = a[5],
        a12 = a[6],
        a13 = a[7],
        a20 = a[8],
        a21 = a[9],
        a22 = a[10],
        a23 = a[11];

    if (a !== out) { // If the source and destination differ, copy the unchanged rows
        out[0]  = a[0];
        out[1]  = a[1];
        out[2]  = a[2];
        out[3]  = a[3];
        out[12] = a[12];
        out[13] = a[13];
        out[14] = a[14];
        out[15] = a[15];
    }

    // Perform axis-specific matrix multiplication
    out[4] = a10 * c + a20 * s;
    out[5] = a11 * c + a21 * s;
    out[6] = a12 * c + a22 * s;
    out[7] = a13 * c + a23 * s;
    out[8] = a20 * c - a10 * s;
    out[9] = a21 * c - a11 * s;
    out[10] = a22 * c - a12 * s;
    out[11] = a23 * c - a13 * s;
    return out;
};

/**
 * Rotates a matrix by the given angle around the Y axis
 *
 * @param {mat4} out the receiving matrix
 * @param {mat4} a the matrix to rotate
 * @param {Number} rad the angle to rotate the matrix by
 * @returns {mat4} out
 */
mat4.rotateY = function (out, a, rad) {
    var s = M.sin(rad),
        c = M.cos(rad),
        a00 = a[0],
        a01 = a[1],
        a02 = a[2],
        a03 = a[3],
        a20 = a[8],
        a21 = a[9],
        a22 = a[10],
        a23 = a[11];

    if (a !== out) { // If the source and destination differ, copy the unchanged rows
        out[4]  = a[4];
        out[5]  = a[5];
        out[6]  = a[6];
        out[7]  = a[7];
        out[12] = a[12];
        out[13] = a[13];
        out[14] = a[14];
        out[15] = a[15];
    }

    // Perform axis-specific matrix multiplication
    out[0] = a00 * c - a20 * s;
    out[1] = a01 * c - a21 * s;
    out[2] = a02 * c - a22 * s;
    out[3] = a03 * c - a23 * s;
    out[8] = a00 * s + a20 * c;
    out[9] = a01 * s + a21 * c;
    out[10] = a02 * s + a22 * c;
    out[11] = a03 * s + a23 * c;
    return out;
};

/**
 * Rotates a matrix by the given angle around the Z axis
 *
 * @param {mat4} out the receiving matrix
 * @param {mat4} a the matrix to rotate
 * @param {Number} rad the angle to rotate the matrix by
 * @returns {mat4} out
 */
mat4.rotateZ = function (out, a, rad) {
    var s = M.sin(rad),
        c = M.cos(rad),
        a00 = a[0],
        a01 = a[1],
        a02 = a[2],
        a03 = a[3],
        a10 = a[4],
        a11 = a[5],
        a12 = a[6],
        a13 = a[7];

    if (a !== out) { // If the source and destination differ, copy the unchanged last row
        out[8]  = a[8];
        out[9]  = a[9];
        out[10] = a[10];
        out[11] = a[11];
        out[12] = a[12];
        out[13] = a[13];
        out[14] = a[14];
        out[15] = a[15];
    }

    // Perform axis-specific matrix multiplication
    out[0] = a00 * c + a10 * s;
    out[1] = a01 * c + a11 * s;
    out[2] = a02 * c + a12 * s;
    out[3] = a03 * c + a13 * s;
    out[4] = a10 * c - a00 * s;
    out[5] = a11 * c - a01 * s;
    out[6] = a12 * c - a02 * s;
    out[7] = a13 * c - a03 * s;
    return out;
};

/**
 * Creates a matrix from a quaternion rotation and vector translation
 * This is equivalent to (but much faster than):
 *
 *     mat4.identity(dest);
 *     mat4.translate(dest, vec);
 *     var quatMat = mat4.create();
 *     quat4.toMat4(quat, quatMat);
 *     mat4.multiply(dest, quatMat);
 *
 * @param {mat4} out mat4 receiving operation result
 * @param {quat4} q Rotation quaternion
 * @param {vec3} v Translation vector
 * @returns {mat4} out
 */
mat4.fromRotationTranslation = function (out, q, v) {
    // Quaternion math
    var x = q[0], y = q[1], z = q[2], w = q[3],
        x2 = x + x,
        y2 = y + y,
        z2 = z + z,

        xx = x * x2,
        xy = x * y2,
        xz = x * z2,
        yy = y * y2,
        yz = y * z2,
        zz = z * z2,
        wx = w * x2,
        wy = w * y2,
        wz = w * z2;

    out[0] = 1 - (yy + zz);
    out[1] = xy + wz;
    out[2] = xz - wy;
    out[3] = 0;
    out[4] = xy - wz;
    out[5] = 1 - (xx + zz);
    out[6] = yz + wx;
    out[7] = 0;
    out[8] = xz + wy;
    out[9] = yz - wx;
    out[10] = 1 - (xx + yy);
    out[11] = 0;
    out[12] = v[0];
    out[13] = v[1];
    out[14] = v[2];
    out[15] = 1;
    
    return out;
};

mat4.fromQuat = function (out, q) {
    var x = q[0], y = q[1], z = q[2], w = q[3],
        x2 = x + x,
        y2 = y + y,
        z2 = z + z,

        xx = x * x2,
        yx = y * x2,
        yy = y * y2,
        zx = z * x2,
        zy = z * y2,
        zz = z * z2,
        wx = w * x2,
        wy = w * y2,
        wz = w * z2;

    out[0] = 1 - yy - zz;
    out[1] = yx + wz;
    out[2] = zx - wy;
    out[3] = 0;

    out[4] = yx - wz;
    out[5] = 1 - xx - zz;
    out[6] = zy + wx;
    out[7] = 0;

    out[8] = zx + wy;
    out[9] = zy - wx;
    out[10] = 1 - xx - yy;
    out[11] = 0;

    out[12] = 0;
    out[13] = 0;
    out[14] = 0;
    out[15] = 1;

    return out;
};

/**
 * Generates a frustum matrix with the given bounds
 *
 * @param {mat4} out mat4 frustum matrix will be written into
 * @param {Number} left Left bound of the frustum
 * @param {Number} right Right bound of the frustum
 * @param {Number} bottom Bottom bound of the frustum
 * @param {Number} top Top bound of the frustum
 * @param {Number} near Near bound of the frustum
 * @param {Number} far Far bound of the frustum
 * @returns {mat4} out
 */
mat4.frustum = function (out, left, right, bottom, top, near, far) {
    var rl = 1 / (right - left),
        tb = 1 / (top - bottom),
        nf = 1 / (near - far);
    out[0] = (near * 2) * rl;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = (near * 2) * tb;
    out[6] = 0;
    out[7] = 0;
    out[8] = (right + left) * rl;
    out[9] = (top + bottom) * tb;
    out[10] = (far + near) * nf;
    out[11] = -1;
    out[12] = 0;
    out[13] = 0;
    out[14] = (far * near * 2) * nf;
    out[15] = 0;
    return out;
};

/**
 * Generates a perspective projection matrix with the given bounds
 *
 * @param {mat4} out mat4 frustum matrix will be written into
 * @param {number} fovy Vertical field of view in radians
 * @param {number} aspect Aspect ratio. typically viewport width/height
 * @param {number} near Near bound of the frustum
 * @param {number} far Far bound of the frustum
 * @returns {mat4} out
 */
mat4.perspective = function (out, fovy, aspect, near, far) {
    var f = 1.0 / M.tan(fovy / 2),
        nf = 1 / (near - far);
    out[0] = f / aspect;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = f;
    out[6] = 0;
    out[7] = 0;
    out[8] = 0;
    out[9] = 0;
    out[10] = (far + near) * nf;
    out[11] = -1;
    out[12] = 0;
    out[13] = 0;
    out[14] = (2 * far * near) * nf;
    out[15] = 0;
    return out;
};

/**
 * Generates a orthogonal projection matrix with the given bounds
 *
 * @param {mat4} out mat4 frustum matrix will be written into
 * @param {number} left Left bound of the frustum
 * @param {number} right Right bound of the frustum
 * @param {number} bottom Bottom bound of the frustum
 * @param {number} top Top bound of the frustum
 * @param {number} near Near bound of the frustum
 * @param {number} far Far bound of the frustum
 * @returns {mat4} out
 */
mat4.ortho = function (out, left, right, bottom, top, near, far) {
    var lr = 1 / (left - right),
        bt = 1 / (bottom - top),
        nf = 1 / (near - far);
    out[0] = -2 * lr;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = -2 * bt;
    out[6] = 0;
    out[7] = 0;
    out[8] = 0;
    out[9] = 0;
    out[10] = 2 * nf;
    out[11] = 0;
    out[12] = (left + right) * lr;
    out[13] = (top + bottom) * bt;
    out[14] = (far + near) * nf;
    out[15] = 1;
    return out;
};

/**
 * Generates a look-at matrix with the given eye position, focal point, and up axis
 *
 * @param {mat4} out mat4 frustum matrix will be written into
 * @param {vec3} eye Position of the viewer
 * @param {vec3} center Point the viewer is looking at
 * @param {vec3} up vec3 pointing up
 * @returns {mat4} out
 */
mat4.lookAt = function (out, eye, center, up) {
    var x = [0,0,0];
    var y = [0,0,0];
    var z = [0,0,0];
    
    vec3.subtract(z, eye, center);
    vec3.normalize(z, z);
    vec3.cross(x, up, z);
    vec3.normalize(x, x);
    vec3.cross(y, z, x);

    out[0] = x[0];
    out[1] = y[0];
    out[2] = z[0];
    out[3] = 0;
    out[4] = x[1];
    out[5] = y[1];
    out[6] = z[1];
    out[7] = 0;
    out[8] = x[2];
    out[9] = y[2];
    out[10] = z[2];
    out[11] = 0;
    out[12] = -vec3.dot(x, eye);
    out[13] = -vec3.dot(y, eye);
    out[14] = -vec3.dot(z, eye);
    out[15] = 1;

    return out;
};

/**
 * Generates a look-at matrix with the given eye position, focal point, and tilt
 *
 * @param {mat4} out mat4 frustum matrix will be written into
 * @param {vec3} eye Position of the viewer
 * @param {vec3} center Point the viewer is looking at
 * @param {vec3} tilt Tilt angle (radians)
 * @returns {mat4} out
 */
mat4.lookAtTilt = function (out, eye, center, tilt) {
    var x = [0,0,0];
    var y = [0,0,0];
    var z = [0,0,0];
    
    vec3.subtract(z, eye, center);
    vec3.normalize(z, z);
    vec3.cross(x, [0,1,0], z);
    vec3.normalize(x, x);
    vec3.cross(y, z, x);
    vec3.scale(y, y, M.cos(tilt))
    vec3.scaleAndAdd(y, y, x, M.sin(tilt));
    vec3.cross(x, y, z);

    out[0] = x[0];
    out[1] = y[0];
    out[2] = z[0];
    out[3] = 0;
    out[4] = x[1];
    out[5] = y[1];
    out[6] = z[1];
    out[7] = 0;
    out[8] = x[2];
    out[9] = y[2];
    out[10] = z[2];
    out[11] = 0;
    out[12] = -vec3.dot(x, eye);
    out[13] = -vec3.dot(y, eye);
    out[14] = -vec3.dot(z, eye);
    out[15] = 1;

    return out;
};

/**
 * Returns a string representation of a mat4
 *
 * @param {mat4} mat matrix to represent as a string
 * @returns {String} string representation of the matrix
 */
mat4.str = function (a) {
    return 'mat4(' + a[0] + ', ' + a[1] + ', ' + a[2] + ', ' + a[3] + ', ' +
                    a[4] + ', ' + a[5] + ', ' + a[6] + ', ' + a[7] + ', ' +
                    a[8] + ', ' + a[9] + ', ' + a[10] + ', ' + a[11] + ', ' + 
                    a[12] + ', ' + a[13] + ', ' + a[14] + ', ' + a[15] + ')';
};

/**
 * Returns Frobenius norm of a mat4
 *
 * @param {mat4} a the matrix to calculate Frobenius norm of
 * @returns {Number} Frobenius norm
 */
mat4.frob = function (a) {
    return(M.sqrt(M.pow(a[0], 2) + M.pow(a[1], 2) + M.pow(a[2], 2) + M.pow(a[3], 2) + M.pow(a[4], 2) + M.pow(a[5], 2) + M.pow(a[6], 2) + M.pow(a[6], 2) + M.pow(a[7], 2) + M.pow(a[8], 2) + M.pow(a[9], 2) + M.pow(a[10], 2) + M.pow(a[11], 2) + M.pow(a[12], 2) + M.pow(a[13], 2) + M.pow(a[14], 2) + M.pow(a[15], 2) ))
};


/* Copyright (c) 2013, Brandon Jones, Colin MacKenzie IV. All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

  * Redistributions of source code must retain the above copyright notice, this
    list of conditions and the following disclaimer.
  * Redistributions in binary form must reproduce the above copyright notice,
    this list of conditions and the following disclaimer in the documentation 
    and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE 
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. */

/**
 * @class Quaternion
 * @name quat
 */

var quat = {};

/**
 * Creates a new identity quat
 *
 * @returns {quat} a new quaternion
 */
quat.create = function() {
    var out = new GLMAT_ARRAY_TYPE(4);
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    out[3] = 1;
    return out;
};

/**
 * Sets a quaternion to represent the shortest rotation from one
 * vector to another.
 *
 * Both vectors are assumed to be unit length.
 *
 * @param {quat} out the receiving quaternion.
 * @param {vec3} a the initial vector
 * @param {vec3} b the destination vector
 * @returns {quat} out
 */
quat.rotationTo = (function() {
    var tmpvec3 = vec3.create();
    var xUnitVec3 = vec3.fromValues(1,0,0);
    var yUnitVec3 = vec3.fromValues(0,1,0);

    return function(out, a, b) {
        var dot = vec3.dot(a, b);
        if (dot < -0.999999) {
            vec3.cross(tmpvec3, xUnitVec3, a);
            if (vec3.length(tmpvec3) < 0.000001)
                vec3.cross(tmpvec3, yUnitVec3, a);
            vec3.normalize(tmpvec3, tmpvec3);
            quat.setAxisAngle(out, tmpvec3, M.PI);
            return out;
        } else if (dot > 0.999999) {
            out[0] = 0;
            out[1] = 0;
            out[2] = 0;
            out[3] = 1;
            return out;
        } else {
            vec3.cross(tmpvec3, a, b);
            out[0] = tmpvec3[0];
            out[1] = tmpvec3[1];
            out[2] = tmpvec3[2];
            out[3] = 1 + dot;
            return quat.normalize(out, out);
        }
    };
})();

/**
 * Sets the specified quaternion with values corresponding to the given
 * axes. Each axis is a vec3 and is expected to be unit length and
 * perpendicular to all other specified axes.
 *
 * @param {vec3} view  the vector representing the viewing direction
 * @param {vec3} right the vector representing the local "right" direction
 * @param {vec3} up    the vector representing the local "up" direction
 * @returns {quat} out
 */
quat.setAxes = (function() {
    var matr = mat3.create();

    return function(out, view, right, up) {
        matr[0] = right[0];
        matr[3] = right[1];
        matr[6] = right[2];

        matr[1] = up[0];
        matr[4] = up[1];
        matr[7] = up[2];

        matr[2] = -view[0];
        matr[5] = -view[1];
        matr[8] = -view[2];

        return quat.normalize(out, quat.fromMat3(out, matr));
    };
})();

/**
 * Creates a new quat initialized with values from an existing quaternion
 *
 * @param {quat} a quaternion to clone
 * @returns {quat} a new quaternion
 * @function
 */
quat.clone = vec4.clone;

/**
 * Creates a new quat initialized with the given values
 *
 * @param {Number} x X component
 * @param {Number} y Y component
 * @param {Number} z Z component
 * @param {Number} w W component
 * @returns {quat} a new quaternion
 * @function
 */
quat.fromValues = vec4.fromValues;

/**
 * Copy the values from one quat to another
 *
 * @param {quat} out the receiving quaternion
 * @param {quat} a the source quaternion
 * @returns {quat} out
 * @function
 */
quat.copy = vec4.copy;

/**
 * Set the components of a quat to the given values
 *
 * @param {quat} out the receiving quaternion
 * @param {Number} x X component
 * @param {Number} y Y component
 * @param {Number} z Z component
 * @param {Number} w W component
 * @returns {quat} out
 * @function
 */
quat.set = vec4.set;

/**
 * Set a quat to the identity quaternion
 *
 * @param {quat} out the receiving quaternion
 * @returns {quat} out
 */
quat.identity = function(out) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    out[3] = 1;
    return out;
};

/**
 * Sets a quat from the given angle and rotation axis,
 * then returns it.
 *
 * @param {quat} out the receiving quaternion
 * @param {vec3} axis the axis around which to rotate
 * @param {Number} rad the angle in radians
 * @returns {quat} out
 **/
quat.setAxisAngle = function(out, axis, rad) {
    rad = rad * 0.5;
    var s = M.sin(rad);
    out[0] = s * axis[0];
    out[1] = s * axis[1];
    out[2] = s * axis[2];
    out[3] = M.cos(rad);
    return out;
};

/**
 * Adds two quat's
 *
 * @param {quat} out the receiving quaternion
 * @param {quat} a the first operand
 * @param {quat} b the second operand
 * @returns {quat} out
 * @function
 */
quat.add = vec4.add;

/**
 * Multiplies two quat's
 *
 * @param {quat} out the receiving quaternion
 * @param {quat} a the first operand
 * @param {quat} b the second operand
 * @returns {quat} out
 */
quat.multiply = function(out, a, b) {
    var ax = a[0], ay = a[1], az = a[2], aw = a[3],
        bx = b[0], by = b[1], bz = b[2], bw = b[3];

    out[0] = ax * bw + aw * bx + ay * bz - az * by;
    out[1] = ay * bw + aw * by + az * bx - ax * bz;
    out[2] = az * bw + aw * bz + ax * by - ay * bx;
    out[3] = aw * bw - ax * bx - ay * by - az * bz;
    return out;
};

/**
 * Alias for {@link quat.multiply}
 * @function
 */
quat.mul = quat.multiply;

/**
 * Scales a quat by a scalar number
 *
 * @param {quat} out the receiving vector
 * @param {quat} a the vector to scale
 * @param {Number} b amount to scale the vector by
 * @returns {quat} out
 * @function
 */
quat.scale = vec4.scale;

/**
 * Rotates a quaternion by the given angle about the X axis
 *
 * @param {quat} out quat receiving operation result
 * @param {quat} a quat to rotate
 * @param {number} rad angle (in radians) to rotate
 * @returns {quat} out
 */
quat.rotateX = function (out, a, rad) {
    rad *= 0.5; 

    var ax = a[0], ay = a[1], az = a[2], aw = a[3],
        bx = M.sin(rad), bw = M.cos(rad);

    out[0] = ax * bw + aw * bx;
    out[1] = ay * bw + az * bx;
    out[2] = az * bw - ay * bx;
    out[3] = aw * bw - ax * bx;
    return out;
};

/**
 * Rotates a quaternion by the given angle about the Y axis
 *
 * @param {quat} out quat receiving operation result
 * @param {quat} a quat to rotate
 * @param {number} rad angle (in radians) to rotate
 * @returns {quat} out
 */
quat.rotateY = function (out, a, rad) {
    rad *= 0.5; 

    var ax = a[0], ay = a[1], az = a[2], aw = a[3],
        by = M.sin(rad), bw = M.cos(rad);

    out[0] = ax * bw - az * by;
    out[1] = ay * bw + aw * by;
    out[2] = az * bw + ax * by;
    out[3] = aw * bw - ay * by;
    return out;
};

/**
 * Rotates a quaternion by the given angle about the Z axis
 *
 * @param {quat} out quat receiving operation result
 * @param {quat} a quat to rotate
 * @param {number} rad angle (in radians) to rotate
 * @returns {quat} out
 */
quat.rotateZ = function (out, a, rad) {
    rad *= 0.5; 

    var ax = a[0], ay = a[1], az = a[2], aw = a[3],
        bz = M.sin(rad), bw = M.cos(rad);

    out[0] = ax * bw + ay * bz;
    out[1] = ay * bw - ax * bz;
    out[2] = az * bw + aw * bz;
    out[3] = aw * bw - az * bz;
    return out;
};

/**
 * Calculates the W component of a quat from the X, Y, and Z components.
 * Assumes that quaternion is 1 unit in length.
 * Any existing W component will be ignored.
 *
 * @param {quat} out the receiving quaternion
 * @param {quat} a quat to calculate W component of
 * @returns {quat} out
 */
quat.calculateW = function (out, a) {
    var x = a[0], y = a[1], z = a[2];

    out[0] = x;
    out[1] = y;
    out[2] = z;
    out[3] = -M.sqrt(M.abs(1.0 - x * x - y * y - z * z));
    return out;
};

/**
 * Calculates the dot product of two quat's
 *
 * @param {quat} a the first operand
 * @param {quat} b the second operand
 * @returns {Number} dot product of a and b
 * @function
 */
quat.dot = vec4.dot;

/**
 * Performs a linear interpolation between two quat's
 *
 * @param {quat} out the receiving quaternion
 * @param {quat} a the first operand
 * @param {quat} b the second operand
 * @param {Number} t interpolation amount between the two inputs
 * @returns {quat} out
 * @function
 */
quat.lerp = vec4.lerp;

/**
 * Performs a spherical linear interpolation between two quat
 *
 * @param {quat} out the receiving quaternion
 * @param {quat} a the first operand
 * @param {quat} b the second operand
 * @param {Number} t interpolation amount between the two inputs
 * @returns {quat} out
 */
quat.slerp = function (out, a, b, t) {
    // benchmarks:
    //    http://jsperf.com/quaternion-slerp-implementations

    var ax = a[0], ay = a[1], az = a[2], aw = a[3],
        bx = b[0], by = b[1], bz = b[2], bw = b[3];

    var        omega, cosom, sinom, scale0, scale1;

    // calc cosine
    cosom = ax * bx + ay * by + az * bz + aw * bw;
    // adjust signs (if necessary)
    if ( cosom < 0.0 ) {
        cosom = -cosom;
        bx = - bx;
        by = - by;
        bz = - bz;
        bw = - bw;
    }
    // calculate coefficients
    if ( (1.0 - cosom) > 0.000001 ) {
        // standard case (slerp)
        omega  = M.acos(cosom);
        sinom  = M.sin(omega);
        scale0 = M.sin((1.0 - t) * omega) / sinom;
        scale1 = M.sin(t * omega) / sinom;
    } else {        
        // "from" and "to" quaternions are very close 
        //  ... so we can do a linear interpolation
        scale0 = 1.0 - t;
        scale1 = t;
    }
    // calculate final values
    out[0] = scale0 * ax + scale1 * bx;
    out[1] = scale0 * ay + scale1 * by;
    out[2] = scale0 * az + scale1 * bz;
    out[3] = scale0 * aw + scale1 * bw;
    
    return out;
};

/**
 * Calculates the inverse of a quat
 *
 * @param {quat} out the receiving quaternion
 * @param {quat} a quat to calculate inverse of
 * @returns {quat} out
 */
quat.invert = function(out, a) {
    var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3],
        dot = a0*a0 + a1*a1 + a2*a2 + a3*a3,
        invDot = dot ? 1.0/dot : 0;
    
    // TODO: Would be faster to return [0,0,0,0] immediately if dot == 0

    out[0] = -a0*invDot;
    out[1] = -a1*invDot;
    out[2] = -a2*invDot;
    out[3] = a3*invDot;
    return out;
};

/**
 * Calculates the conjugate of a quat
 * If the quaternion is normalized, this function is faster than quat.inverse and produces the same result.
 *
 * @param {quat} out the receiving quaternion
 * @param {quat} a quat to calculate conjugate of
 * @returns {quat} out
 */
quat.conjugate = function (out, a) {
    out[0] = -a[0];
    out[1] = -a[1];
    out[2] = -a[2];
    out[3] = a[3];
    return out;
};

/**
 * Calculates the length of a quat
 *
 * @param {quat} a vector to calculate length of
 * @returns {Number} length of a
 * @function
 */
quat.length = vec4.length;

/**
 * Alias for {@link quat.length}
 * @function
 */
quat.len = quat.length;

/**
 * Calculates the squared length of a quat
 *
 * @param {quat} a vector to calculate squared length of
 * @returns {Number} squared length of a
 * @function
 */
quat.squaredLength = vec4.squaredLength;

/**
 * Alias for {@link quat.squaredLength}
 * @function
 */
quat.sqrLen = quat.squaredLength;

/**
 * Normalize a quat
 *
 * @param {quat} out the receiving quaternion
 * @param {quat} a quaternion to normalize
 * @returns {quat} out
 * @function
 */
quat.normalize = vec4.normalize;

/**
 * Creates a quaternion from the given 3x3 rotation matrix.
 *
 * NOTE: The resultant quaternion is not normalized, so you should be sure
 * to renormalize the quaternion yourself where necessary.
 *
 * @param {quat} out the receiving quaternion
 * @param {mat3} m rotation matrix
 * @returns {quat} out
 * @function
 */
quat.fromMat3 = function(out, m) {
    // Algorithm in Ken Shoemake's article in 1987 SIGGRAPH course notes
    // article "Quaternion Calculus and Fast Animation".
    var fTrace = m[0] + m[4] + m[8];
    var fRoot;

    if ( fTrace > 0.0 ) {
        // |w| > 1/2, may as well choose w > 1/2
        fRoot = M.sqrt(fTrace + 1.0);  // 2w
        out[3] = 0.5 * fRoot;
        fRoot = 0.5/fRoot;  // 1/(4w)
        out[0] = (m[7]-m[5])*fRoot;
        out[1] = (m[2]-m[6])*fRoot;
        out[2] = (m[3]-m[1])*fRoot;
    } else {
        // |w| <= 1/2
        var i = 0;
        if ( m[4] > m[0] )
          i = 1;
        if ( m[8] > m[i*3+i] )
          i = 2;
        var j = (i+1)%3;
        var k = (i+2)%3;
        
        fRoot = M.sqrt(m[i*3+i]-m[j*3+j]-m[k*3+k] + 1.0);
        out[i] = 0.5 * fRoot;
        fRoot = 0.5 / fRoot;
        out[3] = (m[k*3+j] - m[j*3+k]) * fRoot;
        out[j] = (m[j*3+i] + m[i*3+j]) * fRoot;
        out[k] = (m[k*3+i] + m[i*3+k]) * fRoot;
    }
    
    return out;
};

/**
 * Returns a string representation of a quatenion
 *
 * @param {quat} vec vector to represent as a string
 * @returns {String} string representation of the vector
 */
quat.str = function (a) {
    return 'quat(' + a[0] + ', ' + a[1] + ', ' + a[2] + ', ' + a[3] + ')';
};

  // change that to true to log
  function log() {
    // console.log.apply(console, arguments);
  }
  function editing() { return false; }
  function n2f(n) {
    return M.pow(2, (n - 69) / 12) * 440;
  }

  AudioNode.prototype.c = AudioNode.prototype.connect;

  ac = new AudioContext();
  minify_context(ac);

  /** @constructor */
  function SND(song) {
    var t = this;
    t.song = song;
    t.initSends()
    t.initInstruments()
    log('SND.constr', this);
    t.playing = false;
  };

  SND.prototype.initSends = function() {
    // GLOBAL !
    _sends = [];
    sends.forEach(function(send, index) {
      var o = new send[0](send[1]);
      _sends.push(o);
      o.c(ac.destination);
    }, this);
  }
  SND.prototype.initInstruments = function() {
    this.instruments = [];
    instruments.forEach(function(instr, index) {
      this.instruments.push(new instr[0](instr[1]));
    }, this);
  };
  SND.extend = function(o, o2) {
    var o1 = {};
    o2 = o2 || {};
    for (var attrname in o) { o1[attrname] = o[attrname]; }
    for (var attrname2 in o2) { o1[attrname2] = o2[attrname2]; }
    return o1;
  }
  SND.AD = function(p/*aram*/, l/*start*/, u/*end*/, t/*startTime*/, a/*attack*/, d/*decay*/) {
    p.setValueAtTime(l, t);
    p.linearRampToValueAtTime(u, t + a);
    // XXX change that to setTargetAtTime
    p.linearRampToValueAtTime(l, t + d);
  };
  SND.D = function(p, t, v, k) {
    p.value = v;
    p.setValueAtTime(v, t);
    p.setTargetAtTime(0, t, k);
  }
  SND.DCA = function(i, v, t, a, d) {
    var g = ac.createGain();
    i.c(g);
    SND.AD(g.gain, 0, v, t, a, d);
    return g;
  };
  function NoiseBuffer() {
    var i,l;
    if (!SND._noisebuffer) {
      SND._noisebuffer = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate / 2);
      var cdata = SND._noisebuffer.getChannelData(0);
      for(i=0,l=cdata.length;i<l;i++) {
        cdata[i] = M.random() * 2.0 - 1.0;
      }
    }
    return SND._noisebuffer;
  }
  SND.ReverbBuffer = function(opts) {
    var i,l;
    var len = ac.sampleRate * opts.l
    var buffer = ac.createBuffer(2, len, ac.sampleRate)
    for(i=0,l=buffer.length;i<l;i++) {
      var s =  M.pow(1 - i / len, opts.d);
      buffer.getChannelData(0)[i] = (M.random() * 2 - 1)*2;
      buffer.getChannelData(1)[i] = (M.random() * 2 - 1)*2;
    }
    return buffer;
  }

  SND.DistCurve = function(k) {
    var c = new Float32Array(ac.sampleRate);
    var deg = M.PI / 180;
    for (var i = 0; i < c.length; i++) {
      var x = i * 2 / c.length - 1;
      c[i] = (3 + k) * x * 20 * deg / (M.PI + k * M.abs(x));
    }
    return c;
  }
  SND.setSends = function(s, out) {
    if (s) {
    _sends.forEach(function(send, i) {
      var amp = ac.createGain();
      amp.gain.value = s[i] || 0.0;
      out.c(amp);
      amp.c(send.destination);
    });
    }
  };

  // In fractional beat
  SND.prototype.t = function() {
    return (ac.currentTime - this.startTime) * (125/ 60);
  }

  SND.prototype.p = function() {
    if (this.playing == true) return;
    if (!this.startTime) this.startTime = ac.currentTime;
    var stepTime = 15 / 125,
        patternTime = stepTime * 64,
        currentTime = ac.currentTime;

    this.currentPos = 0;
    if (editing()) {
      // the patter to loop, or -1 to just play the track
      this.loop = this.loop != undefined ? this.loop : -1;
      // start at the loop if specified, beginning otherwise
      this.currentPos = this.loop != -1 ? this.loop : 0;
    }

    this.playing = true;

    var patternScheduler = (function() {
      if (this.playing == false) return;
      if (currentTime - ac.currentTime < (patternTime / 4)) {
        SND.st = [];
        for(i=0;i<64;i++) { SND.st[i] = currentTime + (stepTime * i); }
        if (this.song.playlist.length == this.currentPos) {
          return;
        }
        var cP = this.song.playlist[this.currentPos];
        log(cP);
        for (var instrId in cP) {
          if (cP.hasOwnProperty(instrId)) {
            log("scheduling", cP[instrId], "for", instrId)
            var data = this.song.patterns[cP[instrId]];
            this.instruments[instrId].pp(SND.st, stepTime, data); 
          }
        }
        if (editing()) {
          if (this.loop == -1) {
            this.currentPos = (this.currentPos + 1) % this.song.playlist.length;
          } else {
            this.currentPos = this.loop;
          }
        } else{
          this.currentPos++;
        }
        currentTime += patternTime;
      }
      setTimeout(patternScheduler, 1000);
    }).bind(this);
    patternScheduler();
  };
  SND.prototype.s = function() {
    this.playing = false;
  }
  
  // SEND EFFECTS
  
  /** @constructor */
  SND.DEL = function() {
    var opts = {t: 0.36, fb: 0.4, m: 0.6, f: 800, q: 2};
    this.delay = ac.createDelay();
    this.delay.delayTime.value = opts.t;
    var fb = ac.createGain();
    var flt = ac.createBiquadFilter();
    flt.type = 'highpass';
    flt.frequency.value = opts.f;
    flt.Q.value = opts.q;
    fb.gain.value = opts.fb;
    this.mix = ac.createGain();
    this.mix.gain.value = opts.m;
    this.delay.c(this.mix);
    this.delay.c(flt);
    flt.c(fb);
    fb.c(this.delay);
    this.c = function(node) {
      this.mix.c(node);
    };
    this.destination = this.delay;
    return this;
  };
  
  /** @constructor */
  SND.REV = function() {
    var opts = {d: 0.05, m: 1};
    var cnv = ac.createConvolver();
    this.mix = ac.createGain();
    cnv.buffer = SND.ReverbBuffer({l: 2, d: opts.d});
    this.mix.gain.value = opts.m;
    cnv.c(this.mix);    
    this.c= function(node) {
      this.mix.c(node);
    };
    this.destination = cnv;
    return this;
  }

  /** @constructor */
  SND.DIST = function() {
    var ws = ac.createWaveShaper();
    this.mix = ac.createGain();
    ws.curve = SND.DistCurve(50);
    this.mix.gain.value = 0.5;
    ws.c(this.mix);
    this.c= function(node) {
      this.mix.c(node);
    };
    this.destination = ws;
    return this;
  }
  
  // INSTRUMENTS
  
  /** @constructor */
  SND.SProto = function(options, defaults) {
    this.ac = ac;
    this.options = SND.extend(defaults, options);
  };
  
  SND.SProto.prototype.pp = function(times, stepTime, data) {
    times.forEach(function(t, i) {
      note = data[i];
      if (typeof(note) !== 'object') {
        note = [note, {}]
      }
      if (note[0] != 0) {
        this.play(t, stepTime, note);
      }
    }, this);
  };
  
  SND.Noise = function() {
    var that = new SND.SProto();
    var noise = NoiseBuffer();
    that.play = function(t) {
      var smp = ac.createBufferSource();
      var flt = ac.createBiquadFilter();
      smp.c(flt);
      var amp = SND.DCA(flt, 0.1, t, 0.001, 0.06);
      flt.frequency.value = 8000;
      flt.type = "highpass";
      flt.Q.value = 8;
      smp.buffer = noise;
      smp.c(amp);
      SND.setSends([0.3], amp);
      amp.c(ac.destination);
      smp.start(t);smp.stop(t + 0.06);
    }
    return that;
  }
  
  SND.Drum = function(options) {
    var that = new SND.SProto(options);
    that.play = function(t) {
      var osc = ac.createOscillator();
      var click = ac.createOscillator();
      click.type = "square";
      click.frequency.value = 40;

      // SND.AD(osc.frequency, opts.en, opts.st, t, 0, opts.k * 8);
      osc.frequency.value = 90;
      osc.frequency.setValueAtTime(90, t);
      osc.frequency.setTargetAtTime(50, t+0.001, 0.03)

      function d(o, e){
        var amp = ac.createGain();
        o.c(amp);
        SND.D(amp.gain, t, 1.3, e);
        amp.c(ac.destination);
      }

      d(osc, 0.03)
      d(click, 0.005)

      osc.start(t);osc.stop(t + 0.2);
      click.start(t);click.stop(t + 0.009);
    }
    return that;
  };

  SND.Snare = function(options) {
    var that = new SND.SProto(options);
    var noise = NoiseBuffer();

    that.play =  function(t) {
      var f = [111 + 175, 111 + 224];
      var o = [];

      // filter for noise and osc
      var fl = ac.createBiquadFilter();
      // fl.type = "lowpass" // default
      fl.frequency.value = 3000;

      // amp for oscillator
      var amposc = ac.createGain();
      SND.D(amposc.gain, t, 0.4, 0.015);

      // two osc
      f.forEach(function(e, i) {
        o[i] = ac.createOscillator();
        o[i].type = "triangle";
        o[i].frequency.value = f[i];
        o[i].c(amposc);
        o[i].start(t); o[i].stop(t + 0.4);
      })

      // noise
      var smp = ac.createBufferSource();
      smp.buffer = noise;
      var ampnoise = ac.createGain();
      smp.c(ampnoise);
      SND.D(ampnoise.gain, t, 0.24, 0.045);
      smp.start(t);smp.stop(t + 0.1);

      ampnoise.c(fl);
      amposc.c(fl);

      SND.setSends([0.3, 0.2], fl);
      fl.c(ac.destination);
    };
    return that;
  };
  
  SND.Synth = function() {
    var that = new SND.SProto();
    that.play = function(t, stepTime, data) {
      var osc = ac.createOscillator();
      var flt = ac.createBiquadFilter();
      flt.Q.value = 2;
      osc.frequency.value = n2f(data[0]);
      osc.type = "square"
      len = stepTime * (data[1].l || 1);
      osc.c(flt);
      var amp = SND.DCA(flt, data[1].v || 0.1, t, 0.01, len);
      SND.setSends([0.5, 0.6], amp);
      amp.c(ac.destination);
      SND.AD(flt.frequency, 200, 2000, t, 0.01, len / 2);
      osc.start(t);osc.stop(t + len);
    }
    return that;
  }

  SND.Sub = function(options) {
    var that = new SND.SProto(options);
    that.play = function(t, stepTime, data) {
      var osc = ac.createOscillator();
      osc.frequency.value = n2f(data[0]);
      len = stepTime * data[1].l;
      // len = stepTime * (data[1].l || 1);
      var amp = SND.DCA(osc, 0.6, t, 0.05, len);
      amp.c(ac.destination);
      osc.start(t);osc.stop(t + len);
    }
    return that;
  }

  SND.Reese = function() {
    var that = new SND.SProto();
    that.play = function(t, stepTime, data) {
      var note = data[0];
      var len = stepTime * data[1].l;

      var flt = ac.createBiquadFilter();
      var o = ac.createOscillator();
      o.frequency.value = data[1].f * (125 / 120); // fetch tempo here.
      var s = ac.createGain();
      s.gain.value = 8000;
      o.c(s);
      s.c(flt.frequency);
      o.start(t); o.stop(t + 10); // long tail
      amp = SND.DCA(flt, data[1].v, t, 0, len);
      for (var i = 0; i < 2; i++) {
        o = ac.createOscillator();
        o.frequency.value = n2f(note);
        o.type = "square";
        o.detune.value = i * 50;
        o.c(flt);
        o.start(t);o.stop(t+len);
      }
      amp.c(ac.destination)
      SND.setSends([0,0.4,1], amp);
    }
    return that;
  }

  SND.Glitch = function(options) {
    var that = new SND.SProto(options);
    var noise = NoiseBuffer();
    that.play = function(t, stepTime, data) {
      var len = (data[1].l || 1) * stepTime;
      var source = ac.createBufferSource();
      var end = t + len;
      var sources = [];
      var i = 0;
      var sink = ac.createGain();
      sink.gain.value = 0.05;
      while (t < end) {
        sources[i] = ac.createBufferSource();
        sources[i].buffer = noise;
        sources[i].loop = true;
        sources[i].loopStart = 0;
        sources[i].loopEnd = M.random() * 0.05;
        sources[i].start(t);
        t += M.random() * 0.5;
        t = M.min(t, end);
        sources[i].stop(t);
        sources[i].c(sink);
        i++;
      }
      sink.c(ac.destination);
      SND.setSends([0.3, 0.8], sink);
    }
    return that;
  }

var vs_shader_source='precision lowp float;uniform vec3 cam_pos,light;uniform mat4 view_proj_mat,view_proj_mat_inv;uniform vec2 resolution;uniform float focus,clip_time,glitch;uniform sampler2D texture_0,texture_1,texture_2,texture_3,texture_4;uniform vec4 text_params,mask;varying vec2 a;varying vec3 b,c;attribute vec3 position,normals;attribute vec2 tex_coords;void h(){float e,f;e=cos(text_params.w);f=sin(text_params.w);mat2 g=mat2(e,-f,f,e);gl_Position=vec4(text_params.xy+g*position.xy*vec2(resolution.y/resolution.x,-1.)*text_params.z,0,1);a=position.xy*.5+.5;}void i(){gl_Position=vec4(position.xy,0,1);a=position.xy*.5+.5;}void j(){gl_Position=view_proj_mat*vec4(position+vec3(0,sin(position.x*position.z/1e5)*20.,0),1);c=position;b=normals;a=tex_coords;}vec3 d=vec3(.9,.9,.8);void k(){gl_Position=vec4(position.xy,0,1);a=(vec2(1)+position.xy)/2.;}void l(){gl_Position=vec4(position.xy,0,1);a=position.xy*.5+.5;}void m(){gl_Position=vec4(text_params.xy+position.xy*text_params.zw,0,1);a=position.xy*.5+.5;}void n(){gl_Position=vec4(position.xy,0,1);a=position.xy*vec2(resolution.x/resolution.y,1);}void o(){gl_Position=vec4(text_params.xy+position.xy*vec2(text_params.w*resolution.y/resolution.x,-1.)*text_params.z,0,1);a=position.xy*.5+.5;}'
var fs_shader_source='precision lowp float;uniform vec3 cam_pos,light;uniform mat4 view_proj_mat,view_proj_mat_inv;uniform vec2 resolution;uniform float focus,clip_time,glitch;uniform sampler2D texture_0,texture_1,texture_2,texture_3,texture_4;uniform vec4 text_params,mask;varying vec2 a;varying vec3 b,c;void D(){gl_FragColor=texture2D(texture_0,a)*mask;}float E(float g){return fract(sin(g)*43758.5453123);}float F(vec2 g){return fract(sin(dot(g.xy,vec2(12.9898,78.233)))*43758.5453);}float G(in vec2 g){vec2 h,i;h=floor(g);i=fract(g);i=i*i*(3.-2.*i);float j,k;j=h.x+h.y*57.;k=mix(mix(E(j+0.),E(j+1.),i.x),mix(E(j+57.),E(j+58.),i.x),i.y);return k;}vec3 H(vec2 g){return vec3(G(g),G(g+2.7),G(g+5.8));}float I(vec2 g,float h,float i,float j,float k){if(g.x>h&&g.x<j&&g.y>i&&g.y<k)return 1.;return 0.;}float J(vec2 g,float h,float i,float j,float k){if((g.x-h)*(g.x-h)/(j*j)+(g.y-i)*(g.y-i)/(k*k)<1.)return 1.;return 0.;}float K(vec2 g){g=mod(g,.02);return J(g,.01,.01,.01,.01)*(1.-J(g,.01,.01,.005,.005));}void L(){vec2 g=a;float h,i,j,k,l,m,n,o,p,q,r,s,t,u,v,w,x;h=.3;i=.02;j=.36;k=.52;l=.1;m=.15;n=.02;o=I(g,0.,.5,1.,.55)*K(g);p=I(g,h,j,.5-i,j+l)+I(g,.5+i,j,1.-h,j+l)+I(g,h,k,.5-i,k+m)+I(g,.5+i,k,1.-h,k+m)+I(g,.15,.13,.4,.25)+I(g,.45,.13,.8,.2);p*=1.-o;q=I(g,h-i,j-n,1.-h+i,j)+J(g,.5,j+l,.22,.02)*I(g,0.,j+l,1.,.5);r=I(g,.03,.1,.13,.25)+I(g,.85,.1,.95,.25)+I(g,.45,.21,.8,.25);s=I(g,0.,.1,1.,.9)-p-q-o-r;t=I(g,0.,.9,1.,1.);u=I(g,0.,0.,.5,.05);v=I(g,0.,.05,1.,.1);w=I(g,.5,0.,1.,.05);x=1.-mod(g.y-.1,.2)*.4;vec3 y=p*vec3(.1)+s*vec3(x,x*.9,x*.7)+t*vec3(.2,.2,.4)*sin(g.x*1e3)+w*vec3(0,.7,.1)+u*vec3(.3)+v*vec3(.5)+q*vec3(.6,.5,.4)+o*vec3(.2)+r*vec3(.5,.1,.1);y*=1.-o;gl_FragColor=vec4(y,p+o+(u+t)*G(g*5e2));}vec3 d=vec3(.9,.9,.8);float M(vec3 g){return dot(g,light)*.5+.5;}vec3 N(vec3 g){float h=pow(M(g),16.);return h*d;}vec3 O(vec3 g){return mix(vec3(.75,.8,.9),vec3(1,.9,.7),M(g));}vec3 P(vec3 g,vec3 h){float i,j;i=distance(c,cam_pos);j=exp(-i*.01);return mix(O(g),h,j);}void Q(){vec4 g=texture2D(texture_0,a);vec2 h=a*2e2;vec3 i,j,k,l,m,n,o;i=(H(h)-.5)*(1.-g.a)*.1;j=normalize(normalize(b)+i);k=(dot(j,light)*.5+.5)*O(j)*g.rgb;l=normalize(cam_pos-c);m=normalize(l+light);n=pow(dot(m,j),1e2)*vec3(g.a);o=clamp(k+n,0.,1.);gl_FragColor=vec4(P(j,o),1);}const float e=.02;const float f=e/5.;float R(vec2 g){return texture2D(texture_1,a+g).r;}float S(float g){const float h=2.;const float i=2e3;g=2.*g-1.;return 2.*h*i/(i+h-g*(i-h));}float T(float g){const float h=1e2;return clamp(abs(g-focus)/h,0.,1.)*e;}void U(){float g,h,i,j,k,l,m,n,o,p,q,r,s,t,v;g=1./resolution.x;h=1./resolution.y;i=R(vec2(0));j=R(vec2(g,0));k=R(vec2(-g,0));l=R(vec2(0,h));m=R(vec2(0,-h));n=R(vec2(g,h));o=R(vec2(g,-h));p=R(vec2(-g,h));q=R(vec2(-g,-h));r=p+2.*k+q-n-2.*j-o;s=-p-2.*l-n+q+2.*m+o;t=1.-10.*sqrt(r*r+s*s);vec3 u=vec3(0);v=0.;for(float w=-e;w<=e;w+=f)for(float x=-e;x<=e;x+=f){vec2 y=vec2(x,w);float z=R(y);if(z<=i){float A,B,C;A=S(z);B=T(A);C=smoothstep(B,B*.5,length(y));u+=C*texture2D(texture_0,a+y).rgb;v+=C;}}u/=v;gl_FragColor=vec4(u*t,1);}void V(){vec2 g,j;g=a;float h,i,k,l;h=floor(G(vec2(clip_time*4.,0))*2.);i=E(floor(g.y*30.)+h*50.*clip_time)-.5;j=floor(g*5.+vec2(i*2.*h,0)*floor(glitch*20.)/1e2)/5.;k=floor(F(j+floor(clip_time*10.)))/2.;l=floor(g.y*20.+F(j)*1e2)/1e2;vec3 m=texture2D(texture_0,g+vec2(k+l,k)*glitch).rgb;m+=vec3(F(g+clip_time))*glitch*.3;m*=1.-pow(length(g-.5)*1.2,4.);gl_FragColor=vec4(m,1);}void W(){gl_FragColor=texture2D(texture_0,a)*mask;}void X(){vec3 g=normalize((view_proj_mat_inv*vec4(a,1,1)).xyz);gl_FragColor=vec4(O(g)+N(g),1);}void Y(){gl_FragColor=texture2D(texture_0,a)*mask;}'
programs = {}
function load_shaders()
{
programs.badge = load_shader_program('h', 'D');
programs.buildings_mtl = load_shader_program('i', 'L');
programs.city = load_shader_program('j', 'Q');
programs.depth_of_field = load_shader_program('k', 'U');
programs.posteffect = load_shader_program('l', 'V');
programs.quad = load_shader_program('m', 'W');
programs.sky = load_shader_program('n', 'X');
programs.text = load_shader_program('o', 'Y');
}
var city_size = 700;
var num_subdivs = 40;

function generate_map() {
  return city_subdivision_rec([[
      { '0': -city_size, '1':  city_size, subdiv: num_subdivs },
      { '0':  city_size, '1':  city_size, subdiv: num_subdivs },
      { '0':  city_size, '1': -city_size, subdiv: num_subdivs },
      { '0': -city_size, '1': -city_size, subdiv: num_subdivs }
    ]
  ], num_subdivs, 7);
}

function uv_buffer(u1, v1, u2, v2) {
  return [[
    u1, v1,
    u2, v1,
    u2, v2,
    u2, v2,
    u1, v2,
    u1, v1
  ]];
}

// u1, v1, u2, v2
function roof_uv() {     return uv_buffer(0, 0.91, 1.0, 0.99); }
function street_uv() {   return uv_buffer(0.1, 0.01, 0.45, 0.045); }
function sidewalk_uv() { return uv_buffer(0.1, 0.055,  0.45, 0.095); }
function interior_uv() { return uv_buffer(0.1, 0.75,  0.9, 0.87); }

function wall_uv(segment_length, face_or_tail) {
  return uv_buffer(
    0, face_or_tail,
    M.floor(segment_length/4), face_or_tail + 0.199
  );
}

function ground_wall_uv(segment_length) {
  return uv_buffer(
    0, 0.1,
    M.floor(segment_length/10), 0.299
  );
}

function bastille(geom) {
  process_extrusions(geom, circle_path([330, 310], 30, 32), [
    { uv: sidewalk_uv,      raise: 1.5 },
    { uv: sidewalk_uv,      shrink: 12 },
    { uv: interior_uv,      raise: 6 },
    { uv: interior_uv,      shrink: 15 },

    { uv: roof_uv,      raise:   12, shrink: 0.3 },
    { uv: roof_uv,      shrink:  -0.2 },
    { uv: roof_uv,      raise:   1 },
    { uv: roof_uv,      shrink:  0.2 },

    { uv: roof_uv,      raise:   12, shrink: 0.3 },
    { uv: roof_uv,      shrink:  -0.2 },
    { uv: roof_uv,      raise:   1 },
    { uv: roof_uv,      shrink:  0.2 },

    { uv: roof_uv,      raise:   12, shrink: 0.3 },
    { uv: roof_uv,      shrink:  -0.2 },
    { uv: roof_uv,      raise:   1 },
    { uv: roof_uv,      shrink:  0.2 },

    { uv: roof_uv,      shrink: 2, raise:  2 }
  ], 0);

  process_extrusions(geom, circle_path([330, 310], 12, 4), [
    { uv: roof_uv,      raise: 10 },
    { uv: roof_uv,      shrink: 4 },
    { uv: roof_uv,      raise: 5 },
    { uv: roof_uv,      shrink: 3 },
    { uv: roof_uv,      raise:   24 },
    { uv: roof_uv,      shrink: -2, raise:  4 },
    { uv: roof_uv,      raise:  2 }
  ], 0);
}

function eiffel(geom) {
 
  process_extrusions(geom, circle_path([-100, -100],75, 4), [
    { uv: roof_uv,      raise: 50 ,shrink: 30 },   
    { uv: roof_uv,      raise: 50 ,shrink: 10 },    
    { uv: roof_uv,      raise: 50 ,shrink: 5 },    
    { uv: roof_uv,      raise: 40 ,shrink: 2 },
    { uv: roof_uv,      raise: 5 ,shrink: -5 },
    { uv: roof_uv,      raise: 10 },
    { uv: roof_uv,      raise: 5 ,shrink: 5 }
    
  ], 0, 50);
 
  process_extrusions(geom, circle_path([-200, -100], 30, 4), [
    { uv: roof_uv,      raise: 50, shrink: 4 , disp:[50,0] }
  ], 0);
  process_extrusions(geom, circle_path([0, -100], 30, 4), [
    { uv: roof_uv,      raise: 50, shrink: 4 , disp:[-50,0] }
  ], 0);
  process_extrusions(geom, circle_path([-100, -200], 30, 4), [
    { uv: roof_uv,      raise: 50, shrink: 4 , disp:[0,50] }
  ], 0);
  process_extrusions(geom, circle_path([-100, 0], 30, 4), [
    { uv: roof_uv,      raise: 50, shrink: 4 , disp:[0,-50] }
  ], 0);
  
  
}

function process_extrusions(geom, path, ops, skip, z0) {
  var path2 = deep_clone(path);
  var path1 = shrink_path(path2, 0.5, 0, 0);
  var z = z0 || 0;

  if (!skip) {
    op_loop: for (var op in ops) {
      var repeat = ops[op].repeat || 1;
      repeat += ops[op].repeat_rand ? rand_int(ops[op].repeat_rand) : 0;
      for (; repeat > 0; --repeat) {
        if (ops[op].shrink) {
          var shrinked = shrink_path(path1, -ops[op].shrink, z, ops[op].use_subdiv, ops[op].disp);
          if (!shrinked) {
            break op_loop;
          }
        }
        path2 = path1;
        path1 = shrinked || path1;
        var raise = ops[op].raise || 0;
        join_rings(geom,
          make_ring(path2, z),
          make_ring(path1, z + raise),
          ops[op].uv
        );
        z += raise;
      }
    }
  }

  fill_convex_ring(geom, make_ring(path1, z));
}

function generate_city_geom(city_paths) {
  var ops = [
    //{ raise: 0,  shrink: 1.5},
    { uv: street_uv,      shrink: 2.1, use_subdiv: 0.2 },
    { uv: street_uv,      raise:  0.5 },
    { uv: sidewalk_uv,    shrink: 4 },
    { uv: ground_wall_uv, raise:  5 },
    { uv: wall_uv,        raise:  4, repeat: 3, repeat_rand: 2 },
    { uv: roof_uv,        raise:  2, shrink: 0.5 },
    { uv: roof_uv,        raise:  1, shrink: 1.5 },
    { uv: roof_uv,        shrink: 6.5 },
    { uv: interior_uv,    raise: -13 }
  ];
  //var num_extrusions = ops.length + 1;


  var geom = {
    positions: [],
    normals: [],
    uvs: []
  }

  for (i = 0; i < city_paths.length; ++i) {
    process_extrusions(geom, city_paths[i], ops, plazza(city_paths[i], [330, 310], 60) || plazza(city_paths[i], [-100, -100], 100));
    /*
    var path2 = deep_clone(city_paths[i]);
    var path1 = shrink_path(path2, 0.5, 0, 0);

    var z = 0;
      op_loop: for (var op in ops) {
        var repeat = ops[op].repeat || 1;
        repeat += ops[op].repeat_rand ? rand_int(ops[op].repeat_rand) : 0;
        for (; repeat > 0; --repeat) {
          if (ops[op].shrink) {
            var shrinked = shrink_path(path1, -ops[op].shrink, z, ops[op].use_subdiv);
            if (!shrinked) {
              break op_loop;
            }
          }
          path2 = path1;
          path1 = shrinked;
          var raise = ops[op].raise || 0;
          join_rings(geom,
            make_ring(path2, z),
            make_ring(path1, z + raise),
            ops[op].uv
          );
          z += raise;
        }
      }
    }

    fill_convex_ring(geom, make_ring(path1, z));
  */
  }

  //var plazza_circle = circle_path([380, 387], 30, 12);
  //join_rings(geom,
  //  make_ring(plazza_circle, 0),
  //  make_ring(plazza_circle, 130),
  //  street_uv
  //);
  bastille(geom);
  eiffel(geom);

  return {
    buffers: [
      make_vbo(POS, geom.positions),
      make_vbo(NORMALS, geom.normals),
      make_vbo(TEX_COORDS, geom.uvs)
    ],
    mode: gl.TRIANGLES,
    vertex_count: geom.positions.length / 3
  };
}


function texture_fill_rect(x, y, w, h, style) {
  var sz = 2048;
  textureContext.fillStyle = style;
  textureContext.fillRect(x*sz, y*sz, w*sz, h*sz);
}

function create_buildings_texture() {
  clear_texture_canvas();
  texture_fill_rect(0, 0, 1, 1, "#D6B363")
  texture_fill_rect(0, 0.0, 0.5, 0.1, "#D6B363") // street
  texture_fill_rect(0, 0.1, 0.5, 0.1, "#D6B363") // sidewalk
  texture_fill_rect(0.5, 0, 0.5, 0.2, "#D6B363") // grass
  texture_fill_rect(0, 0.1, 0.5, 0.1, "#D6B363") // grass

  texture_fill_rect(0.4, 0.35, 0.2, 0.3, "#000") // window inner
  texture_fill_rect(0.4, 0.35, 0.2, 0.3, "#000") // window outer
}

function create_text_texture(fontSize, text) {
  clear_texture_canvas();
  
  fontSize *= 100;
  textureContext.font = fontSize + "px Calibri";

  var width = 3 + textureContext.measureText(text).width|0,
    height = fontSize * 1.50;
  
  textureContext.fillStyle = "#fff";
  textureContext.fillText(text, 2, fontSize);
  
  return [create_texture(width, height, gl.RGBA, textureContext.getImageData(0, 0, width, height).data, false, true), width / height];
}

function create_badge_texture(badgeDiameter, text1, text2, text3) {
  clear_texture_canvas();
  
  badgeDiameter *= 100;
  // stamp
  var gradient = textureContext.createLinearGradient(0, 0, badgeDiameter, badgeDiameter);
  gradient.addColorStop(0, "#7bf");
  gradient.addColorStop(1, "#579");
  textureContext.fillStyle = gradient;
  textureContext.beginPath();
  textureContext.moveTo(badgeDiameter * 0.99, badgeDiameter / 2);
  for (var i = 1; i < 49; ++i) {
    var radius = badgeDiameter * ((i % 2) ? 0.4 : 0.49);
    textureContext.lineTo(badgeDiameter / 2 + radius * M.cos(i / 24 * M.PI), badgeDiameter / 2 + radius * M.sin(i / 24 * M.PI));
  }
  textureContext.fill();
  
  // transparent circle
  textureContext.beginPath();
  textureContext.globalCompositeOperation = 'destination-out';
  textureContext.moveTo(badgeDiameter * 0.85, badgeDiameter / 2);
  textureContext.arc(badgeDiameter / 2, badgeDiameter / 2, badgeDiameter * 0.35, M.PI*2, false);
  textureContext.lineWidth = badgeDiameter / 2 * 0.07;
  textureContext.stroke();
  textureContext.globalCompositeOperation = 'source-over';
  
  textureContext.fillStyle = "#fff";
  
  textureContext.font = badgeDiameter + "px impact";
  var width = textureContext.measureText(text2 || text1).width;
  
  var fontSize = 0.8 * badgeDiameter * badgeDiameter / width;
  if (text3) {
     fontSize *= 0.7; 
  }
  textureContext.font = fontSize + "px impact";
  
  width = textureContext.measureText(text1).width;

  if (text2) {
    var t3 = text3 ? 3 : 2;
    var s = 
    textureContext.fillText(text1, (badgeDiameter - width)/2, badgeDiameter / t3);
    textureContext.fillText(text2, (badgeDiameter - textureContext.measureText(text2).width)/2, badgeDiameter / t3 + fontSize * 1.0);
    if (text3) {
      textureContext.fillText(text3, (badgeDiameter - textureContext.measureText(text3).width)/2, badgeDiameter / 3 + fontSize * 2.0);
    }
  } else
    textureContext.fillText(text1, (badgeDiameter - width)/2, badgeDiameter / 2 + fontSize / 3);
  
  var height = width = badgeDiameter;
  
  return create_texture(width, height, gl.RGBA, textureContext.getImageData(0, 0, width, height).data, false, true);
}

function create_street_sign_texture(text) {
  clear_texture_canvas();
  
  textureContext.font = "100px verdana";

  var width = 100 + textureContext.measureText(text).width,
    height = 140,
    margin = 12,
    margin2 = 2 * margin;
  
  textureContext.fillStyle = "#579";
  textureContext.fillRect(0, 0, width, height);
  
  textureContext.beginPath();
  textureContext.moveTo(margin2, margin);
  textureContext.lineTo(width - margin2, margin);
  textureContext.arcTo(width - margin2, margin2, width - margin, margin2, margin);
  textureContext.lineTo(width - margin, height - margin2);
  textureContext.arcTo(width - margin2, height - margin2, width - margin2, height - margin, margin);
  textureContext.lineTo(margin2, height - margin);
  textureContext.arcTo(margin2, height - margin2, margin, height - margin2, margin);
  textureContext.lineTo(margin, margin2);
  textureContext.arcTo(margin2, margin2, margin2, margin, margin);
  textureContext.lineWidth = 2;
  textureContext.strokeStyle = "#fff";
  textureContext.stroke();
  
  textureContext.fillStyle = "#fff";
  textureContext.fillText(text, 50, 110);
  
  return create_texture(width, height, gl.RGBA, textureContext.getImageData(0, 0, width, height).data, false, true);
}

function create_dev_tool() {
  clear_texture_canvas();
  
  var width = 2048,
    height = 300;
  
  textureContext.fillStyle = '#222';
  textureContext.fillRect(0, 0, width, height);
  
  textureContext.fillStyle = '#fff';
  textureContext.fillRect(2, 40, width - 4, height);
  
  textureContext.font = 30 + "px serif";
  textureContext.fillText("Elements  Network  Sources  Timeline  Profiles  Console", 40, 30);
  
  textureContext.font = 40 + "px courier";
  textureContext.fillStyle = '#f11';
  textureContext.fillText("TypeError: undefined is not a function", 20, 80);
  
  return create_texture(width, height, gl.RGBA, textureContext.getImageData(0, 0, width, height).data, false, true);
}

function text_alpha(time, appearance, disappearance) {
  return M.max(M.min(M.min(time - appearance, disappearance - time) * 0.8, 1), 0);
}

function text_x(x, time, appearance) {
  return x + M.exp((appearance - time) * 0.2) * 0.2;
}

function text_y(y, range_start, factor, time, appearance) {
  return y + M.exp((appearance - time) * factor) * range_start
}

function badge_size(t) {
  return 0.4 - M.sqrt(1 - (t % 1)) * 0.1;
}

function badge_pass(texture, x, y, size, angle_base, angle_range, angle_offset, appearance, disappearance, ghost) {
  return {
    render_to: {color: textures.tex3},
    texture_inputs: [texture],
    render: draw_quad,
    program: programs.badge,
    update: function(time)
    {
      if (ghost) {
        uniforms["text_params"] = [x, y, size * ((time.scene % 2) / 4 + 0.75), angle_base];
        uniforms["mask"] = [1, 1, 1, (time.scene > appearance && time.scene < disappearance && (time.scene % 2) >= 1) ? 2 - (time.scene % 2) : 0];
      } else {
        uniforms["text_params"] = [x, y, size * (1 - M.abs(time.scene % 2 - 1) * 0.2), angle_base + M.sin(time.scene + angle_offset) * angle_range];
        uniforms["mask"] = [1, 1, 1, Math.max(Math.min(Math.min(time.scene - appearance,disappearance - time.scene), 1), 0)];
      }
    }
  }
}

function demo_init() {
  SEED = 1;
  var width = canvas.width;
  var height = canvas.height;

  gl.getExtension("WEBGL_depth_texture")

  textures.depth      = create_texture(width, height, gl.DEPTH_COMPONENT);
  textures.buildings  = create_texture(512, 512, 0, 0, 1);

  textures.tex1       = create_texture();
  textures.tex3       = create_texture();


  var city_map = generate_map();
  //var city_graph = generate_city_graph(city_map);
  geometries.city = generate_city_geom(city_map);
  window.map = city_map;

  textures.demoJSIsBack = create_text_texture(1, "DemoJS is back");
  
  textures.comeAndEnjoy = create_text_texture(1, "Come and enjoy");
  textures.thePureSensation = create_text_texture(1, "the pure sensation of JS");
  
  textures.noCompilationTime = create_text_texture(1, "No compilation time");
  textures.justRelax = create_text_texture(1, "just relax");
  
  textures.noSegmentationFaults = create_text_texture(1, "No segmentation faults");
  textures.everythingUnderControl = create_text_texture(1, "everything under control");
  
  textures.devTool = create_dev_tool();

  textures.bFuckJS = create_badge_texture(8, "FuckJS");
  
  textures.youKnowWhat = create_text_texture(1, "You know what?");
  textures.thisTime = create_text_texture(1, "This time");
  textures.notOnlyForJS = create_text_texture(2, "it's not JS only!");
  textures.comeParty = create_text_texture(2, "Come party with us");
  textures.inParis = create_text_texture(2, "in Paris!"); 

  
  textures.bCpp = create_badge_texture(2, "C++");
  textures.bASM = create_badge_texture(2, "ASM");
  textures.bHaskell = create_badge_texture(2, "Haskell");
  textures.bOldskool = create_badge_texture(2, "Oldskool");
  textures.bToaster = create_badge_texture(2, "Toaster");
  textures.bWebfunge = create_badge_texture(2, "Webfunge");
  
  textures.showYourSkills = create_text_texture(1, "Show your skills");
  textures.getTheGlory = create_text_texture(2, "Get the glory!");
  
  textures.b1k = create_badge_texture(2, "1k");
  textures.b8k = create_badge_texture(2, "8k");
  textures.bDemo = create_badge_texture(2, "demo");
  
  textures.date = create_text_texture(1, "Oct 10-11, 2014");
  textures.location = create_text_texture(1, "Isart Digital, Paris");
  textures.conferences = create_text_texture(2, "Conferences");
  textures.concerts = create_text_texture(2, "Concerts");
  textures.come = create_text_texture(2, "Come");
  textures.to = create_text_texture(1, "to");
  textures.demojs = create_text_texture(2, "DemoJS!");


  textures.bFreeEntrance = create_badge_texture(8, "FREE", "entrance");
  textures.bRemoteAllowed = create_badge_texture(8, "Remote", "entries", "allowed");
  
  uniforms["light"] = [0.7, 0.0, -0.7];
  //uniforms["near"] = 0.98;
  //uniforms["far"] = 0.998;
  uniforms["focus"] = 100;

  scenes = [
    // ------------------------------ pre-render ----------------------------------
    {
      duration: 0,
      passes: [
        {
          render_to: {color: textures.buildings},
          render: draw_quad,
          program: programs.buildings_mtl
        },
        {
          update: function() {
            // Make the texture repeatable. We need to do this after rendering
            // into it because rendering into a repeatable texture isn't supported.
            set_texture_flags(textures.buildings.tex, 1, 1, 1);
          }
        }
      ]
    },
    intro_scene(),
    fuck_js(),
    not_only_js_scene(),
    compos_scene(),
    location_scene()
  ];
}

function intro_scene() {
  return {
    duration: 80,
    passes: [
      {
        render_to: {color: textures.tex1, depth: textures.depth},
        render: clear
      },
      {
        render_to: {color: textures.tex1, depth: textures.depth},
        render: draw_quad,
        program: programs.sky
      },
      {
        texture_inputs: [textures.buildings],
        render_to: {color: textures.tex1, depth: textures.depth},
        update: function(time) {
			var radius = 300;
			var angle = time.scene * 0.00004;
          uniforms["cam_pos"] = [radius * Math.cos(angle), 50, radius * Math.sin(angle)];
			var radius = 150;
			var angle = time.scene * 0.0002;
          uniforms["cam_target"] = [radius * Math.cos(angle), 40, radius * Math.sin(angle)];
            
          uniforms["light"] = [0.707, 0.707, 0];
        },
        render: draw_mesh(geometries.city),
        program: programs.city
      },
      {
        // render_to: {color: textures.tex3},
        texture_inputs: [
          textures.tex1,
          textures.depth
        ],
        render: draw_quad,
        program: programs.depth_of_field
      },/*
      {
        texture_inputs: [textures.tex3],
        render: draw_quad,
        program: programs.posteffect,
        update: function(time)
        {
          uniforms["glitch"] = M.min(M.max(time.scene - 48, 0) * 0.06 / 16 + (time.scene >= 64), 1.0);
        }
      }*/
    ]
  }
}

function fuck_js()
{
  return {
    duration: 32,
    passes: [
      {
        render_to: {color: textures.tex1, depth: textures.depth},
        render: clear
      },
      {
        render_to: {color: textures.tex1, depth: textures.depth},
        render: draw_quad,
        program: programs.sky
      },
      {
        texture_inputs: [textures.buildings],
        render_to: {color: textures.tex1, depth: textures.depth},
        update: function(time) {
          uniforms["cam_pos"] = animate([
              [0, [500, 50, 200]],
              [0, [250, 100, 300]],
              [32, [0, 30, 500]]
            ], time.scene);
          uniforms["cam_target"] = [1000, 0, 0];
          uniforms["light"] = [0.707, 0.707, 0];
          uniforms["cam_tilt"] = time.scene;
        },
        render: draw_mesh(geometries.city),
        program: programs.city
      },
      {
        render_to: {color: textures.tex3},
        texture_inputs: [
          textures.tex1,
          textures.depth
        ],
        render: draw_quad,
        program: programs.depth_of_field
      },
      {
        render_to: {color: textures.tex3},
        blend: [gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA],
        texture_inputs: [textures.bFuckJS],
        render: draw_quad,
        program: programs.badge,
        update: function(time)
        {
          var pulse = M.exp(-time.scene % 1);
          uniforms["text_params"] = [0, 0, 1 + pulse * 0.2, pulse - M.sin(time.scene)];
          uniforms["mask"] = [1, 1, 1, pulse * 0.8];
          uniforms["glitch"] = M.pow(pulse, 30);
        }
      },
      badge_pass(textures.bFuckJS, 0, 0, 1, 0.2, 0.2, 0, 0, 32),
      {
        texture_inputs: [textures.tex3],
        render: draw_quad,
        program: programs.posteffect
      }
    ]
  };
}

function not_only_js_scene() {
  return {
    duration: 32,
    passes: [
      {
        render_to: {color: textures.tex1, depth: textures.depth},
        render: clear
      },
      {
        render_to: {color: textures.tex1, depth: textures.depth},
        render: draw_quad,
        program: programs.sky
      },
      {
        texture_inputs: [textures.buildings],
        render_to: {color: textures.tex1, depth: textures.depth},
        update: function(time) {
          uniforms["cam_pos"] = animate([
              [0, [370, 50, 0]],
              [8, [353, 10, -89.4]],
              [32, [303, -10, -358]]
            ], time.scene);
          uniforms["cam_target"] = animate([
              [0, [352, 20, -89.4]],
              [8, [280, 10, -447]],
              [32, [400, -10, -600]]
            ], time.scene);
            
          uniforms["light"] = [0.707, 0.707, 0];
          uniforms["cam_tilt"] = time.scene_norm - 0.5;
        },
        render: draw_mesh(geometries.city),
        program: programs.city
      },
      {
        render_to: {color: textures.tex3},
        texture_inputs: [
          textures.tex1,
          textures.depth
        ],
        render: draw_quad,
        program: programs.depth_of_field
      },
      {
        render_to: {color: textures.tex3},
        blend: [gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA],
        texture_inputs: [textures.youKnowWhat[0]],
        render: draw_quad,
        program: programs.text,
        update: function(time)
        {
          uniforms["text_params"] = [0, text_y(0.7, -0.3, 0.5, time.scene, 2), 0.18, textures.youKnowWhat[1]];
          uniforms["mask"] = [0.2, 0.3, 0.4, time.scene > 2];
        }
      },
      {
        render_to: {color: textures.tex3},
        blend: [gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA],
        texture_inputs: [textures.thisTime[0]],
        render: draw_quad,
        program: programs.text,
        update: function(time)
        {
          uniforms["text_params"] = [0, text_y(0.4, -0.3, 0.5, time.scene, 2), 0.18, textures.thisTime[1]];
          uniforms["mask"] = [0.2, 0.3, 0.4, time.scene > 3];
        }
      },
      {
        render_to: {color: textures.tex3},
        texture_inputs: [textures.notOnlyForJS[0]],
        render: draw_quad,
        program: programs.text,
        update: function(time)
        {
          uniforms["text_params"] = [0, text_y(0.1, -0.3, 0.5, time.scene, 4), 0.20, textures.notOnlyForJS[1]];
          uniforms["mask"] = [0.7, 0.7, 0.7,, time.scene > 4];
        }
      },
      badge_pass(textures.bCpp, -0.7, -0.4, 0.4, 0.2, 0.2, 0, 8, 26, 1),
      badge_pass(textures.bCpp, -0.7, -0.4, 0.4, 0.2, 0.2, 0, 8, 26),
      badge_pass(textures.bASM, -0.15, -0.45, 0.4, -0.1, 0.2, 0, 10, 26, 1),
      badge_pass(textures.bASM, -0.15, -0.45, 0.4, -0.1, 0.2, 0, 10, 26),
      badge_pass(textures.bOldskool, 0.4, -0.4, 0.4, -0.1, 0.2, 0, 12, 26, 1),
      badge_pass(textures.bOldskool, 0.4, -0.4, 0.4, -0.1, 0.2, 0, 12, 26),
      badge_pass(textures.bHaskell, -0.45, -0.7, 0.4, -0.4, 0.2, 0, 14, 26, 1),
      badge_pass(textures.bHaskell, -0.45, -0.7, 0.4, -0.4, 0.2, 0, 14, 26),
      badge_pass(textures.bToaster, 0.1, -0.8, 0.4, 0.6, 0.2, 0, 16, 26, 1),
      badge_pass(textures.bToaster, 0.1, -0.8, 0.4, 0.6, 0.2, 0, 16, 26),
      badge_pass(textures.bWebfunge, 0.7, -0.7, 0.4, -0.2, 0.2, 0, 18, 26, 1),
      badge_pass(textures.bWebfunge, 0.7, -0.7, 0.4, -0.2, 0.2, 0, 18, 26),
      {
        render_to: {color: textures.tex3},
        texture_inputs: [textures.comeParty[0]],
        render: draw_quad,
        program: programs.text,
        update: function(time)
        {
          uniforms["text_params"] = [0.008, text_y(-0.305, -0.3, 0.5, time.scene, 27), 0.20, textures.comeParty[1]];
          uniforms["mask"] = [0.3, 0.3, 0.3, time.scene > 28];
        }
      },
      {
        render_to: {color: textures.tex3},
        texture_inputs: [textures.comeParty[0]],
        render: draw_quad,
        program: programs.text,
        update: function(time)
        {
          uniforms["text_params"] = [0, text_y(-0.3, -0.3, 0.5, time.scene, 27), 0.20, textures.comeParty[1]];
          uniforms["mask"] = [0.7, 0.7, 0.8, time.scene > 28];
        }
      },
      {
        render_to: {color: textures.tex3},
        texture_inputs: [textures.inParis[0]],
        render: draw_quad,
        program: programs.text,
        update: function(time)
        {
          uniforms["text_params"] = [0, text_y(-0.6, -0.3, 0.5, time.scene, 28), 0.20, textures.inParis[1]];
          uniforms["mask"] = [0.7, 0.7, 0.8, time.scene > 29];
        }
      },
      {
        texture_inputs: [textures.tex3],
        render: draw_quad,
        program: programs.posteffect,
        update: function(time)
        {
          uniforms["glitch"] = 0;
        }
      }
    ]
  };
}

function compos_scene() {
  return {
    duration: 32,
    passes: [
      {
        render_to: {color: textures.tex1, depth: textures.depth},
        render: clear
      },
      {
        render_to: {color: textures.tex1, depth: textures.depth},
        render: draw_quad,
        program: programs.sky
      },
      {
        texture_inputs: [textures.buildings],
        render_to: {color: textures.tex1, depth: textures.depth},
        update: function(time) {
          uniforms["cam_pos"] = animate([
              [0, [-323, 150, -303]],
              [32, [360, 100, -303]]
            ], time.scene);
          uniforms["cam_target"] = animate([
              [0, [-320, 0, -303]],
              [32, [380, 0, -303]]
            ], time.scene);
          uniforms["light"] = [0.707, 0.707, 0];
        },
        render: draw_mesh(geometries.city),
        program: programs.city
      },
      {
        render_to: {color: textures.tex3},
        texture_inputs: [
          textures.tex1,
          textures.depth
        ],
        render: draw_quad,
        program: programs.depth_of_field
      },
      {
        render_to: {color: textures.tex3},
        blend: [gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA],
        texture_inputs: [textures.showYourSkills[0]],
        render: draw_quad,
        program: programs.text,
        update: function(time)
        {
          uniforms["text_params"] = [0, text_y(-0.7, 0.3, 0.5, time.scene, 2), 0.18, textures.demoJSIsBack[1]];
          uniforms["mask"] = [0.2, 0.3, 0.4, time.scene > 2];
        }
      },
      {
        render_to: {color: textures.tex3},
        texture_inputs: [textures.getTheGlory[0]],
        render: draw_quad,
        program: programs.text,
        update: function(time)
        {
          uniforms["text_params"] = [0, text_y(-0.4, 0.3, 0.5, time.scene, 4), 0.28, textures.getTheGlory[1]];
          uniforms["mask"] = [0.2, 0.3, 0.4, time.scene > 4];
        }
      },
      badge_pass(textures.b1k, -0.6, 0.2, 0.4, 0.2, 0.2, 0, 8, 32, 1),
      badge_pass(textures.b1k, -0.6, 0.2, 0.4, 0.2, 0.2, 0, 8, 32),
      badge_pass(textures.b8k, 0, 0.5, 0.4, -0.1, 0.2, 0, 10, 32, 1),
      badge_pass(textures.b8k, 0, 0.5, 0.4, -0.1, 0.2, 0, 10, 32),
      badge_pass(textures.bDemo, 0.5, 0.1, 0.4, -0.4, 0.2, 0, 12, 32, 1),
      badge_pass(textures.bDemo, 0.5, 0.1, 0.4, -0.4, 0.2, 0, 12, 32),
      {
        texture_inputs: [textures.tex3],
        render: draw_quad,
        program: programs.posteffect,
        update: function(time)
        {
          uniforms["glitch"] = 0;
        }
      }
    ]
  }
}

function location_scene() {
  return {
    duration: 64,
    passes: [
      {
        render_to: {color: textures.tex1, depth: textures.depth},
        render: clear
      },
      {
        render_to: {color: textures.tex1, depth: textures.depth},
        render: draw_quad,
        program: programs.sky
      },
      {
        texture_inputs: [textures.buildings],
        render_to: {color: textures.tex1, depth: textures.depth},
        update: function(time) {
          uniforms["cam_pos"] = animate([
              [0, [340, 50, -300]],
              [8, [360, 10, -330]],
              [16, [350, 15, -350]],
              [24, [320, 5, -350]],
              [32, [250, 50, -320]],
              [48, [150, 50, -320]]
            ], time.scene);
          uniforms["cam_target"] = animate([
              [0, [330, 0, -310]],
              [8, [320, 10, -320]],
              [16, [300, 10, -310]],
              [24, [100, 20, -300]],
              [32, [80, 70, -250]],
              [48, [35, 40, -250]]
            ], time.scene);
          
      //     uniforms["cam_tilt"] = time.scene > 24 ? -0.8 * (time.scene - 24) / 8 : 0;
          uniforms["light"] = [0.707, 0.707, 0];
        },
        render: draw_mesh(geometries.city),
        program: programs.city
      },
      {
        render_to: {color: textures.tex3},
        texture_inputs: [
          textures.tex1,
          textures.depth
        ],
        render: draw_quad,
        program: programs.depth_of_field
      },
      {
        render_to: {color: textures.tex3},
        blend: [gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA],
        texture_inputs: [textures.date[0]],
        render: draw_quad,
        program: programs.text,
        update: function(time)
        {
          uniforms["text_params"] = [text_x(0.35, time.scene, 4), 0.7, 0.2, textures.date[1]];
          uniforms["mask"] = [0.2, 0.3, 0.4, text_alpha(time.scene, 4, 32)];
        }
      },
      {
        render_to: {color: textures.tex3},
        texture_inputs: [textures.location[0]],
        render: draw_quad,
        program: programs.text,
        update: function(time)
        {
          uniforms["text_params"] = [text_x(0.35, time.scene, 8), 0.4, 0.14, textures.location[1]];
          uniforms["mask"] = [0.2, 0.3, 0.4, text_alpha(time.scene, 8, 32)];
        }
      },
      {
        render_to: {color: textures.tex3},
        texture_inputs: [textures.concerts[0]],
        render: draw_quad,
        program: programs.text,
        update: function(time)
        {
          uniforms["text_params"] = [text_x(0.36, time.scene, 16), -0.6, 0.22, textures.concerts[1]];
          uniforms["mask"] = [0.6, 0.6, 0.6, text_alpha(time.scene, 16, 32)];
        }
      },
      {
        render_to: {color: textures.tex3},
        texture_inputs: [textures.conferences[0]],
        render: draw_quad,
        program: programs.text,
        update: function(time)
        {
          uniforms["text_params"] = [text_x(0.36, time.scene, 12), -0.2, 0.18, textures.conferences[1]];
          uniforms["mask"] = [0.6, 0.6, 0.6, text_alpha(time.scene, 12, 32)];
        }
      },

      {
        render_to: {color: textures.tex3},
        texture_inputs: [textures.conferences[0]],
        render: draw_quad,
        program: programs.text,
        update: function(time)
        {
          uniforms["text_params"] = [text_x(0.35, time.scene, 12), -0.2, 0.18, textures.conferences[1]];
          uniforms["mask"] = [0.2, 0.3, 0.4, text_alpha(time.scene, 12, 32)];
        }
      },
      {
        render_to: {color: textures.tex3},
        texture_inputs: [textures.concerts[0]],
        render: draw_quad,
        program: programs.text,
        update: function(time)
        {
          uniforms["text_params"] = [text_x(0.35, time.scene, 16), -0.6, 0.22, textures.concerts[1]];
          uniforms["mask"] = [0.2, 0.3, 0.4, text_alpha(time.scene, 16, 32)];
        }
      },
      

      badge_pass(textures.bFreeEntrance, -0.5, -0.4, 0.6, 0.2, 0.2, 0, 22, 32, 1),
      badge_pass(textures.bFreeEntrance, -0.5, -0.4, 0.6, 0.2, 0.2, 0, 22, 32),
      badge_pass(textures.bRemoteAllowed, -0.7, 0.4, 0.4, -0.3, 0.2, 0.7, 26, 32, 1),
      badge_pass(textures.bRemoteAllowed, -0.7, 0.4, 0.4, -0.3, 0.2, 0.7, 26, 32),
      {
        render_to: {color: textures.tex3},
        texture_inputs: [textures.come[0]],
        render: draw_quad,
        program: programs.text,
        update: function(time)
        {
          uniforms["text_params"] = [text_x(0.35, time.scene, 32), .5, 0.22, textures.come[1]];
          uniforms["mask"] = [0.2, 0.3, 0.4, text_alpha(time.scene, 32, 64)];
        }
      },
      {
        render_to: {color: textures.tex3},
        texture_inputs: [textures.to[0]],
        render: draw_quad,
        program: programs.text,
        update: function(time)
        {
          uniforms["text_params"] = [text_x(0.35, time.scene, 32), 0, 0.22, textures.to[1]];
          uniforms["mask"] = [0.2, 0.3, 0.4, text_alpha(time.scene, 33, 64)];
        }
      },
      {
        render_to: {color: textures.tex3},
        texture_inputs: [textures.demojs[0]],
        render: draw_quad,
        program: programs.text,
        update: function(time)
        {
          uniforms["text_params"] = [text_x(0.35, time.scene, 32), -.5, 0.22, textures.demojs[1]];
          uniforms["mask"] = [0.2, 0.3, 0.4, text_alpha(time.scene, 34, 64)];
        }
      },
      {
        texture_inputs: [textures.tex3],
        render: draw_quad,
        program: programs.posteffect,
        update: function(time)
        {
          uniforms["glitch"] = time.scene > 48 ? 1.0 : 0.0;
        }
      }
    ]
  }
}
  sends = [[SND.DEL],[SND.REV],[SND.DIST]]
  instruments = [[SND.Drum],[SND.Synth],[SND.Noise],[SND.Reese],[SND.Sub],[SND.Snare],[SND.Glitch]]
  SONG = {playlist:[{3:0},{1:1,3:1},{3:0,1:1,0:6,4:2},{0:6,4:2, 1:3, 5:15,
  6:19},{6:12},{0:6,1:0,2:7,3:0,4:2,5:4},{0:6,1:0,2:7,3:0,4:2,5:4},{0:6,1:9,2:7,3:10,4:2,5:4},{0:6,1:11,2:7,3:10,4:8,5:4},{0:6,1:9,2:7,3:10,4:2,5:15},{0:16,1:11,2:17,3:10,4:8,5:18},{0:6,1:9,2:7,3:10,4:2},{0:6,1:11,2:7,3:10,4:2},{0:6,1:9,2:7,3:10,4:2},{6:12}],patterns:[[[72,{v:0.002,f:0.05,l:64}],0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,[72,{l:32,f:0.01,v:0.01}],0,0,0,0,0,0,0,0,0,0,0,0,0,0,[48,{l:32,f:0.01,v:0.01}],0,0,0,0,0,0,0,0,[36,{l:32,f:0.1,v:0.01}],0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[[60,{f:0.001,v:0.01,l:32}],0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,[60,{f:0.001,v:0.01,l:32}],0,0,0,0,0,0,0,0,0,[60,{f:0.001,v:0.02,l:64}],0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,[60,{f:0.01,v:0.02,l:32}],0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[[36,{l:4}],0,0,0,0,[36,{l:4}],0,0,0,[36,{l:4}],0,0,0,0,0,0,[39,{l:4}],0,0,0,0,0,0,0,[41,{l:2}],0,[41,{l:4}],0,0,0,0,0,[36,{l:4}],0,0,0,0,[36,{l:2}],0,0,0,0,0,0,0,0,0,0,[41,{l:8}],0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0],[0,0,0,0,0,0,[1,{v:0.2}],0,0,0,0,0,0,0,[1,{v:0.2}],0,0,0,0,0,0,0,[1,{v:0.2}],0,0,0,0,0,0,0,[1,{v:0.2}],0,0,0,0,0,0,0,[1,{v:0.2}],0,0,0,0,0,0,0,[1,{v:0.2}],0,0,0,0,0,0,0,[1,{v:0.2}],0,0,0,0,0,0,0,0,0],[0,0,[1,{v:0.01}],0,0,0,[1,{v:0.02}],0,0,0,[1,{v:0.03}],0,0,0,[1,{v:0.04}],0,0,0,[1,{v:0.05}],0,0,0,[1,{v:0.07}],0,0,0,[1,{v:0.09}],0,0,0,[1,{v:0.1}],0,0,0,[1,{v:0.11}],0,0,0,[1,{v:0.17}],0,0,0,[1,{v:0.2}],0,0,0,[1,{v:0.3}],0,0,0,[1,{v:0.5}],0,0,0,[1,{v:0.5}],0,0,0,[1,{v:0.5}],0,0,0,[1,{v:0.5}],0],[1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0],[0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0],[[36,{l:16}],0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,[43,{l:16}],0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,[39,{l:16}],0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,[41,{l:16}],0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[[60,{l:16}],0,0,0,0,0,0,0,0,0,0,0,0,0,[63,{l:2}],0,[48,{l:16}],0,0,0,0,0,65,65,0,0,0,0,[65,{l:16}],0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,[36,{l:32,f:0.005,v:0.05}],0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[[60,{l:16}],0,0,0,0,0,0,0,0,0,0,0,0,0,[63,{l:2}],0,[48,{l:8}],0,0,0,0,0,65,65,0,0,0,0,[62,{l:16}],0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[[1,{l:32}],0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[[60,{l:16}],0,0,0,0,0,0,0,0,0,0,0,0,0,[63,{l:2}],0,[48,{l:8}],0,0,0,0,0,65,65,0,0,0,0,[60,{l:16}],0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,[36,{l:32,f:0.1}],0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],[1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,0,0,0,0],[0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,0,0,0,0,0,0],[0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,1,0,1,0,0,0], [0,0,0,1 ,0,0,0,0 ,0,0,0,1 ,0,0,0,0 ,0,0,1,0 ,0,1,1,1, ,0,0,0,1, ,0,0,0,0]]};
   function compressing() {
  return false;
}

function compress() {
  // partition before compressing
SONG2 = {cfg:{tempo:125},sends:[[SND.DEL],[SND.REV],[SND.DIST]],instruments:[[SND.Drum,{sw:0.04,d:0.2,k:0.03,st:90,en:50,v:1}],[SND.Synth,{q:2,d:0.5,fm:1800,f:200,s:[0.5,0.6],t:"square",v:0.1}],[SND.Noise,{q:8,d:0.06,ft:"highpass",f:8000,v:0.1,s:[0.3]}],[SND.Reese,{t:"square",lfo:1,co:8000,v:0.1,s:[0,0.4,1]}],[SND.Sub,{t:"sine",v:0.4,d:2}],[SND.Snare,{t:"triangle",sw:0,d:0.1,st:3000,f:3000,en:50,k:0.015,v:0.6,s:[0.03,0.2],ft:"bandpass"}],[SND.Glitch,{}]],playlist:[{"3":0},{"1":1,"3":1},{"6":12},{"3":0},{"1":1,"3":1},{"0":6,"1":0,"2":7,"3":0,"4":2,"5":4},{"0":6,"1":0,"2":7,"3":0,"4":2,"5":4},{"0":6,"1":9,"2":7,"3":10,"4":2,"5":4},{"0":6,"1":11,"2":7,"3":10,"4":8,"5":4},{"0":6,"1":9,"2":7,"3":10,"4":2,"5":15},{"0":16,"1":11,"2":17,"3":10,"4":8,"5":18},{"0":6,"1":9,"2":7,"3":10,"4":2},{"0":6,"1":11,"2":7,"3":10},{"1":0,"3":0}],patterns:[[[72,{v:0.002,lfo:0.05,l:64,co:4000}],0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,[72,{l:32,lfo:0.01,v:0.01}],0,0,0,0,0,0,0,0,0,0,0,0,0,0,[48,{l:32,lfo:0.01,v:0.01}],0,0,0,0,0,0,0,0,[36,{l:32,lfo:0.1,v:0.01}],0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[[60,{lfo:0.001,v:0.01,l:32}],0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,[60,{lfo:0.001,v:0.01,l:32}],0,0,0,0,0,0,0,0,0,[60,{lfo:0.001,v:0.02,l:64}],0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,[60,{lfo:0.01,v:0.02,l:32}],0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[[36,{l:4}],0,0,0,0,[36,{l:4}],0,0,0,[36,{l:4}],0,0,0,0,0,0,[39,{l:4}],0,0,0,0,0,0,0,[41,{l:2}],0,[41,{l:4}],0,0,0,0,0,[36,{l:4}],0,0,0,0,[36,{l:2}],0,0,0,0,0,0,0,0,0,0,[41,{l:8}],0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[286331153,286331153],[0,0,0,0,0,0,[1,{v:0.2}],0,0,0,0,0,0,0,[1,{v:0.2}],0,0,0,0,0,0,0,[1,{v:0.2}],0,0,0,0,0,0,0,[1,{v:0.2}],0,0,0,0,0,0,0,[1,{v:0.2}],0,0,0,0,0,0,0,[1,{v:0.2}],0,0,0,0,0,0,0,[1,{v:0.2}],0,0,0,0,0,0,0,0,0],[0,0,[1,{v:0.01}],0,0,0,[1,{v:0.02}],0,0,0,[1,{v:0.03}],0,0,0,[1,{v:0.04}],0,0,0,[1,{v:0.05}],0,0,0,[1,{v:0.07}],0,0,0,[1,{v:0.09}],0,0,0,[1,{v:0.1}],0,0,0,[1,{v:0.11}],0,0,0,[1,{v:0.17}],0,0,0,[1,{v:0.2}],0,0,0,[1,{v:0.3}],0,0,0,[1,{v:0.5}],0,0,0,[1,{v:0.5}],0,0,0,[1,{v:0.5}],0,0,0,[1,{v:0.5}],0],[286331153,286331153],[1145324612,1145324612],[[36,{l:16}],0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,[43,{l:16}],0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,[39,{l:16}],0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,[41,{l:16}],0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[[60,{l:16}],0,0,0,0,0,0,0,0,0,0,0,0,0,[63,{l:2}],0,[48,{l:16}],0,0,0,0,0,65,65,0,0,0,0,[65,{l:16}],0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,[36,{l:32,lfo:0.005,v:0.05}],0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[[60,{l:16}],0,0,0,0,0,0,0,0,0,0,0,0,0,[63,{l:2}],0,[48,{l:8}],0,0,0,0,0,65,65,0,0,0,0,[62,{l:16}],0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[1,0],[[60,{l:16}],0,0,0,0,0,0,0,0,0,0,0,0,0,[63,{l:2}],0,[48,{l:8}],0,0,0,0,0,65,65,0,0,0,0,[60,{l:16}],0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,[36,{l:32,lfo:0.1}]],[269488144,269488144],[286331153,17895697],[1145324612,4473924],[269488144,336597008]]};
  if (!compressing()) {
    return;
  }
  function is_perc(p) {
    for (var i = 0; i < 64; i++) {
      if (p[i] != 0 && p[i] != 1) {
        return false;
      }
    }
    return true;
  }

  var compressed = [];
  var patterns = SONG.patterns;
  for (var i = 0; i < patterns.length; i++) {
    if (is_perc(patterns[i])) {
      console.log("compressing " + i);
      compressed[i] = [];
      for(var j = 0; j < 64; j++) {
        compressed[i][j] = patterns[i][j];
      }
      patterns[i] = compress_perc_pattern(patterns[i]);
    }
  }
}


// var p = SONG.patterns;
// for (var i = 0; i < p.length; i++) {
//   // patterns.length == 2
//   if (p[i][2] == undefined) {
//     var c = [];
//     for (var j = 64; j;) {
//       c[--j] = (p[i][(j/32)|0] >> (j%32)) & 1;
//     }
//     p[i] = c;
//     if (compressing()) {
//       for (var j = 0 ; j < 64; j++) {
//         if (p[i][j] != compressed[i][j]) {
//           console.log("different at " + i + " " + j);
//           console.log(p[i][j], compressed[i][j]);
//         }
//       }
//     }
//   }
// }
onload=main;

addEventListener('wheel', function(event) {
	event.preventDefault();
	var size = parseInt(document.body.firstChild.style.fontSize);
	if (event.deltaY > 0) size *= 1.1;
	if (event.deltaY < 0) size /= 1.1;
	document.body.firstChild.style.fontSize = size + 'px';
});