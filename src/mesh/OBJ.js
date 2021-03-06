mesh.OBJ = (function() {

  function parseMTL(str) {
    var
      lines = str.split(/[\r\n]/g),
      cols,
      materials = {},
      data = null;

    for (var i = 0, il = lines.length; i < il; i++) {
      cols = lines[i].trim().split(/\s+/);

      switch (cols[0]) {
        case 'newmtl':
          storeMaterial(materials, data);
          data = { id:cols[1], color:{} };
          break;

        case 'Kd':
          data.color = [
            parseFloat(cols[1]),
            parseFloat(cols[2]),
            parseFloat(cols[3])
          ];
          break;

        case 'd':
          data.color[3] = parseFloat(cols[1]);
          break;
      }
    }

    storeMaterial(materials, data);
    str = null;

    return materials;
  }

  function storeMaterial(materials, data) {
    if (data !== null) {
      materials[ data.id ] = data.color;
    }
  }

  function parseOBJ(str, materials) {
    var
      vertexIndex = [],
      lines = str.split(/[\r\n]/g), cols,
      meshes = [],
      id,
      color,
      faces = [];

    for (var i = 0, il = lines.length; i < il; i++) {
      cols = lines[i].trim().split(/\s+/);

      switch (cols[0]) {
        case 'g':
        case 'o':
          storeOBJ(vertexIndex, meshes, id, color, faces);
          id = cols[1];
          faces = [];
          break;

        case 'usemtl':
          storeOBJ(vertexIndex, meshes, id, color, faces);
          if (materials[ cols[1] ]) {
            color = materials[ cols[1] ];
          }
          faces = [];
          break;

        case 'v':
          vertexIndex.push([parseFloat(cols[1]), parseFloat(cols[2]), parseFloat(cols[3])]);
          break;

        case 'f':
          faces.push([ parseFloat(cols[1])-1, parseFloat(cols[2])-1, parseFloat(cols[3])-1 ]);
          break;
      }
    }

    storeOBJ(vertexIndex, meshes, id, color, faces);
    str = null;

    return meshes;
  }

  function storeOBJ(vertexIndex, meshes, id, color, faces) {
    if (faces.length) {
      var geometry = createGeometry(vertexIndex, faces);
      meshes.push({
        vertices: geometry.vertices,
        normals: geometry.normals,
        color: color,
        texCoords: geometry.texCoords,
        id: id,
        height: geometry.height
      });
    }
  }

  function createGeometry(vertexIndex, faces) {
    var
      v0, v1, v2,
      nor,
      vertices = [],
      normals = [],
      texCoords = [],
      height = -Infinity;

    for (var i = 0, il = faces.length; i < il; i++) {
      v0 = vertexIndex[ faces[i][0] ];
      v1 = vertexIndex[ faces[i][1] ];
      v2 = vertexIndex[ faces[i][2] ];

      nor = normal(v0, v1, v2);

      vertices.push(
        v0[0], v0[2], v0[1],
        v1[0], v1[2], v1[1],
        v2[0], v2[2], v2[1]
      );

      normals.push(
        nor[0], nor[1], nor[2],
        nor[0], nor[1], nor[2],
        nor[0], nor[1], nor[2]
      );

      texCoords.push(
        0.0, 0.0,
        0.0, 0.0,
        0.0, 0.0
      );

      height = Math.max(height, v0[1], v1[1], v2[1]);
    }

    return { vertices:vertices, normals:normals, texCoords:texCoords, height:height };
  }

  //***************************************************************************

  function constructor(url, position, options) {
    options = options || {};

    this.forcedId = options.id;

    if (options.color) {
      this.forcedColor = Color.parse(options.color).toArray();
    }

    this.replace      = !!options.replace;
    this.scale        = options.scale     || 1;
    this.rotation     = options.rotation  || 0;
    this.elevation    = options.elevation || 0;
    this.position     = position;
    this.shouldFadeIn = 'fadeIn' in options ? !!options.fadeIn : true;

    this.minZoom = Math.max(parseFloat(options.minZoom || MIN_ZOOM), APP.minZoom);
    this.maxZoom = Math.min(parseFloat(options.maxZoom || MAX_ZOOM), APP.maxZoom);
    if (this.maxZoom < this.minZoom) {
      this.minZoom = MIN_ZOOM;
      this.maxZoom = MAX_ZOOM;
    }

    this.data = {
      vertices: [],
      normals: [],
      colors: [],
      texCoords: [],
      ids: []
    };

    Activity.setBusy();
    this.request = Request.getText(url, function(obj) {
      this.request = null;
      var match;
      if ((match = obj.match(/^mtllib\s+(.*)$/m))) {
        this.request = Request.getText(url.replace(/[^\/]+$/, '') + match[1], function(mtl) {
          this.request = null;
          this.onLoad(obj, parseMTL(mtl));
        }.bind(this));
      } else {
        this.onLoad(obj, null);
      }
    }.bind(this));
  }

  constructor.prototype = {
    onLoad: function(obj, mtl) {
      this.items = [];
      this.addItems( parseOBJ(obj, mtl) );
      this.onReady();
    },

    addItems: function(items) {
      items.map(function(feature) {
        /**
         * Fired when a 3d object has been loaded
         * @fires OSMBuildings#loadfeature
         */
        APP.emit('loadfeature', feature);

        [].push.apply(this.data.vertices,  feature.vertices);
        [].push.apply(this.data.normals,   feature.normals);
        [].push.apply(this.data.texCoords, feature.texCoords);

        var
          id = this.forcedId || feature.id,
          idColor = render.Picking.idToColor(id),
          colorVariance = (id/2 % 2 ? -1 : +1) * (id % 2 ? 0.03 : 0.06),
          color = this.forcedColor || feature.color || DEFAULT_COLOR;

        for (var i = 0; i < feature.vertices.length-2; i += 3) {
          [].push.apply(this.data.colors, add3scalar(color, colorVariance));
          [].push.apply(this.data.ids, idColor);
        }

        this.items.push({ id:id, vertexCount:feature.vertices.length/3, height:feature.height, data:feature.data });
      }.bind(this));
    },

    _initItemBuffers: function() {
      var
        start = Filter.getTime(),
        end = start;

      if (this.shouldFadeIn) {
        start += 250;
        end += 750;
      }

      var
        filters = [],
        heights = [];

      this.items.map(function(item) {
        item.filter = [start, end, 0, 1];
        for (var i = 0; i < item.vertexCount; i++) {
          filters.push.apply(filters, item.filter);
          heights.push(item.height);
        }
      });

      this.filterBuffer = new GLX.Buffer(4, new Float32Array(filters));
      this.heightBuffer = new GLX.Buffer(1, new Float32Array(heights));
    },

    applyFilter: function() {
      var filters = [];
      this.items.map(function(item) {
        for (var i = 0; i < item.vertexCount; i++) {
          filters.push.apply(filters, item.filter);
        }
      });

      this.filterBuffer = new GLX.Buffer(4, new Float32Array(filters));
    },

    onReady: function() {
      this.vertexBuffer   = new GLX.Buffer(3, new Float32Array(this.data.vertices));
      this.normalBuffer   = new GLX.Buffer(3, new Float32Array(this.data.normals));
      this.colorBuffer    = new GLX.Buffer(3, new Float32Array(this.data.colors));
      this.texCoordBuffer = new GLX.Buffer(2, new Float32Array(this.data.texCoords));
      this.idBuffer       = new GLX.Buffer(3, new Float32Array(this.data.ids));
      this._initItemBuffers();

      this.data = null;

      Filter.apply(this);
      data.Index.add(this);

      this.isReady = true;
      Activity.setIdle();
    },

    // TODO: switch to a notation like mesh.transform
    getMatrix: function() {
      var matrix = new GLX.Matrix();

      if (this.elevation) {
        matrix.translate(0, 0, this.elevation);
      }

      matrix.scale(this.scale, this.scale, this.scale);

      if (this.rotation) {
        matrix.rotateZ(-this.rotation);
      }

      var metersPerDegreeLongitude = METERS_PER_DEGREE_LATITUDE * 
                                     Math.cos(APP.position.latitude / 180 * Math.PI);

      var dLat = this.position.latitude - APP.position.latitude;
      var dLon = this.position.longitude- APP.position.longitude;
      
      matrix.translate( dLon * metersPerDegreeLongitude,
                       -dLat * METERS_PER_DEGREE_LATITUDE, 0);
      
      return matrix;
    },

    destroy: function() {
      data.Index.remove(this);

      if (this.request) {
        this.request.abort();
      }

      this.items = [];

      if (this.isReady) {
        this.vertexBuffer.destroy();
        this.normalBuffer.destroy();
        this.colorBuffer.destroy();
        this.texCoordBuffer.destroy();
        this.idBuffer.destroy();
        this.heightBuffer.destroy();
      }
    }
  };

  return constructor;

}());
