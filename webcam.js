// WebcamJS v1.0.26
// Biblioteca de cámaras web para capturar imágenes JPEG/PNG en JavaScript
// Intentos getUserMedia, vuelve a Flash
// Autor: Joseph Huckaby: http://github.com/jhuckaby
// Basado en JPEGCam: http://code.google.com/p/jpegcam/
// Copyright (c) 2012 - 2019 Joseph Huckaby
// Licenciado bajo la licencia MIT

(function(window) {
var _userMedia;

// declarar tipos de error

// patrón de herencia aquí:
// https://stackoverflow.com/questions/783818/how-do-i-create-a-custom-error-in-javascript
function FlashError() {
	var temp = Error.apply(this, arguments);
	temp.name = this.name = "FlashError";
	this.stack = temp.stack;
	this.message = temp.message;
}

function WebcamError() {
	var temp = Error.apply(this, arguments);
	temp.name = this.name = "WebcamError";
	this.stack = temp.stack;
	this.message = temp.message;
}

var IntermediateInheritor = function() {};
IntermediateInheritor.prototype = Error.prototype;

FlashError.prototype = new IntermediateInheritor();
WebcamError.prototype = new IntermediateInheritor();

var Webcam = {
	version: '1.0.26',
	
	// globales
	protocol: location.protocol.match(/https/i) ? 'https' : 'http',
	loaded: false,   // true wcuando la película cámara web termina de cargar
	live: false,     // true cuando la cámara web es inicializada  y está lista para fotografiar
	userMedia: true, // true cuando getUserMedia es soportado de manera nativa.

	iOS: /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream,

	params: {
		width: 0,
		height: 0,
		dest_width: 0,         // tamaño de la imagen capturada
		dest_height: 0,        // estos para largo y ancho por defecto
		image_format: 'jpeg',  // formato de la imagen (puede ser jpeg o png)
		jpeg_quality: 90,      // calidad de la imagen jpeg de 0 (peor) a 100 (mejor)
		enable_flash: true,    // habilitar flash fallback (respaldo),
		force_flash: false,    // modo de flash de fuerza,
		flip_horiz: false,     // cambiar image horiz (modo espejo)
		fps: 30,               // fotogramas or segundo
		upload_name: 'webcam', // nombre del archivo en los datos de envío
		constraints: null,     // restricción personalizada de medios del usuario,
		swfURL: '',            // URI para la grabación webcam.swf (por defecto de la ubicación js)
		flashNotDetectedText: 'ERROR: No  se detectó el reproductor Adobe Flash Player.  Webcam.js depende de Flash para navegadores que no admiten getUserMedia (como el tuyo).',
		noInterfaceFoundText: 'No se encontó ninguna interfaz de cámara web compatible',
		unfreeze_snap: true,    // Si desea descongelar la cámara después del complemento (por defecto es true)
		iosPlaceholderText: 'Haz clic aquí para abrir la cámara.',
		user_callback: null,    // función callback para una imagen instantánea (se utiliza si no hay parámetro user_callback dado a la función snap)
		user_canvas: null       // lienzo proporcionado por el usuario para la imagen instantánea (utilizado si no hay parámetro user_canvas dado a la función snap)
	},

	errors: {
		FlashError: FlashError,
		WebcamError: WebcamError
	},
	
	hooks: {}, // Funciones callback hook 
	
	init: function() {
		// Inicializar, revisar para sopoerte getUserMedia
		var self = this;
		
		// Configurar getUserMedia, con polyfill para los navegadores más antiguos
		// Adaptado por: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
		this.mediaDevices = (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) ? 
			navigator.mediaDevices : ((navigator.mozGetUserMedia || navigator.webkitGetUserMedia) ? {
				getUserMedia: function(c) {
					return new Promise(function(y, n) {
						(navigator.mozGetUserMedia ||
						navigator.webkitGetUserMedia).call(navigator, c, y, n);
					});
				}
		} : null);
		
		window.URL = window.URL || window.webkitURL || window.mozURL || window.msURL;
		this.userMedia = this.userMedia && !!this.mediaDevices && !!window.URL;
		
		// Versiones anteriores de Firefox (< 21) aparentemente requieren soporte, pero los medios del usuario no funcionan actualmente
		if (navigator.userAgent.match(/Firefox\D+(\d+)/)) {
			if (parseInt(RegExp.$1, 10) < 21) this.userMedia = null;
		}
		
		// Asegúrate de que el flujo de medios está cerrado cuando se navega fuera de la página
		if (this.userMedia) {
			window.addEventListener( 'beforeunload', function(event) {
				self.reset();
			} );
		}
	},
	
	exifOrientation: function(binFile) {
		// extrae información de orientación de la imagen proporcionada por iOS
		// algoritmo basado en exif-js
		var dataView = new DataView(binFile);
		if ((dataView.getUint8(0) != 0xFF) || (dataView.getUint8(1) != 0xD8)) {
			console.log('Archivo JPEG no válido');
			return 0;
		}
		var offset = 2;
		var marker = null;
		while (offset < binFile.byteLength) {
			// find 0xFFE1 (225 marker)
			if (dataView.getUint8(offset) != 0xFF) {
				console.log('No es un marcador válido en offset ' + offset + ', encontrado: ' + dataView.getUint8(offset));
				return 0;
			}
			marker = dataView.getUint8(offset + 1);
			if (marker == 225) {
				offset += 4;
				var str = "";
				for (n = 0; n < 4; n++) {
					str += String.fromCharCode(dataView.getUint8(offset+n));
				}
				if (str != 'Exif') {
					console.log('No se encontraron datos EXIF válidos');
					return 0;
				}
				
				offset += 6; // tiffOffset
				var bigEnd = null;

				// prueba para validar TIFF y endianness
				if (dataView.getUint16(offset) == 0x4949) {
					bigEnd = false;
				} else if (dataView.getUint16(offset) == 0x4D4D) {
					bigEnd = true;
				} else {
					console.log("No se encontraron datos TIFF validos! (no 0x4949 or 0x4D4D)");
					return 0;
				}

				if (dataView.getUint16(offset+2, !bigEnd) != 0x002A) {
					console.log("o se encontraron datos TIFF validosa! (no 0x002A)");
					return 0;
				}

				var firstIFDOffset = dataView.getUint32(offset+4, !bigEnd);
				if (firstIFDOffset < 0x00000008) {
					console.log("Datos TIFF no validos (Primera compensación menor a 8)", dataView.getUint32(offset+4, !bigEnd));
					return 0;
				}

				// Extrae datos de la orientación
				var dataStart = offset + firstIFDOffset;
				var entries = dataView.getUint16(dataStart, !bigEnd);
				for (var i=0; i<entries; i++) {
					var entryOffset = dataStart + i*12 + 2;
					if (dataView.getUint16(entryOffset, !bigEnd) == 0x0112) {
						var valueType = dataView.getUint16(entryOffset+2, !bigEnd);
						var numValues = dataView.getUint32(entryOffset+4, !bigEnd);
						if (valueType != 3 && numValues != 1) {
							console.log('Tipo de valor de orientación EXIF no válido ('+valueType+') o cuenta ('+numValues+')');
							return 0;
						}
						var value = dataView.getUint16(entryOffset + 8, !bigEnd);
						if (value < 1 || value > 8) {
							console.log('Valor de orientación EXIF no válido ('+value+')');
							return 0;
						}
						return value;
					}
				}
			} else {
				offset += 2+dataView.getUint16(offset+2);
			}
		}
		return 0;
	},
	
	fixOrientation: function(origObjURL, orientation, targetImg) {
		// Orientación de imagen flix basada en datos de orientación exif
		// información de orientación exif
		//    http://www.impulseadventure.com/photo/exif-orientation.html
		//   enlance de la fuente en wikipedia (https://en.wikipedia.org/wiki/Exif#cite_note-20)
		var img = new Image();
		img.addEventListener('load', function(event) {
			var canvas = document.createElement('canvas');
			var ctx = canvas.getContext('2d');
			
			// cambia la altura de la orientación si lo requiere
			if (orientation < 5) {
				canvas.width = img.width;
				canvas.height = img.height;
			} else {
				canvas.width = img.height;
				canvas.height = img.width;
			}

			// transforma (gira) la imagen - ve el enlace al inicio
			switch (orientation) {
				case 2: ctx.transform(-1, 0, 0, 1, img.width, 0); break;
				case 3: ctx.transform(-1, 0, 0, -1, img.width, img.height); break;
				case 4: ctx.transform(1, 0, 0, -1, 0, img.height); break;
				case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
				case 6: ctx.transform(0, 1, -1, 0, img.height , 0); break;
				case 7: ctx.transform(0, -1, -1, 0, img.height, img.width); break;
				case 8: ctx.transform(0, -1, 1, 0, 0, img.width); break;
			}

			ctx.drawImage(img, 0, 0);
			// pasa los datos de imagen girados al contenedor de imagen de destino
			targetImg.src = canvas.toDataURL();
		}, false);
		// inicia la transformación por evento de carga
		img.src = origObjURL;
	},
	
	attach: function(elem) {
		// crea una vista previa de la cámara web y adjunta el elemento DOM
		// Pasa la actual referencia DOM, ID o selector CSS
		if (typeof(elem) == 'string') {
			elem = document.getElementById(elem) || document.querySelector(elem);
		}
		if (!elem) {
			return this.dispatch('error', new WebcamError("No se puede localizar el elemento DOM para adjuntarlo."));
		}
		this.container = elem;
		elem.innerHTML = ''; // incia con elemento vacío
		
		// inserta "peg" para que podamos insertar nuestro lienzo de vista previa adyacente a él más tarde
		var peg = document.createElement('div');
		elem.appendChild( peg );
		this.peg = peg;
		
		// establece ancho/alto si no está ya configurado
		if (!this.params.width) this.params.width = elem.offsetWidth;
		if (!this.params.height) this.params.height = elem.offsetHeight;
		
		// asegúrese de que tenemos un ancho y una altura diferentes a cero en este punto
		if (!this.params.width || !this.params.height) {
			return this.dispatch('error', new WebcamError("No hay ancho y/ o altura para la cámara web.  Por favor, llama a set() primero, o adjunta un elemento visible."));
		}
		
		// establece los valores predeterminados para dest_width / dest_height si no se establece
		if (!this.params.dest_width) this.params.dest_width = this.params.width;
		if (!this.params.dest_height) this.params.dest_height = this.params.height;
		
		this.userMedia = _userMedia === undefined ? this.userMedia : _userMedia;
		// si force_flash estpa establecido, desactiva userMedia
		if (this.params.force_flash) {
			_userMedia = this.userMedia;
			this.userMedia = null;
		}
		
		// revisa de manera predeterminada fps
		if (typeof this.params.fps !== "number") this.params.fps = 30;

		// ajusta la escala si dest_width o dest_height es diferente
		var scaleX = this.params.width / this.params.dest_width;
		var scaleY = this.params.height / this.params.dest_height;
		
		if (this.userMedia) {
			// configura el contenedor de video de la cámara web
			var video = document.createElement('video');
			video.setAttribute('autoplay', 'autoplay');
			video.setAttribute('playsinline', 'playsinline');
			video.style.width = '' + this.params.dest_width + 'px';
			video.style.height = '' + this.params.dest_height + 'px';
			
			if ((scaleX != 1.0) || (scaleY != 1.0)) {
				elem.style.overflow = 'hidden';
				video.style.webkitTransformOrigin = '0px 0px';
				video.style.mozTransformOrigin = '0px 0px';
				video.style.msTransformOrigin = '0px 0px';
				video.style.oTransformOrigin = '0px 0px';
				video.style.transformOrigin = '0px 0px';
				video.style.webkitTransform = 'scaleX('+scaleX+') scaleY('+scaleY+')';
				video.style.mozTransform = 'scaleX('+scaleX+') scaleY('+scaleY+')';
				video.style.msTransform = 'scaleX('+scaleX+') scaleY('+scaleY+')';
				video.style.oTransform = 'scaleX('+scaleX+') scaleY('+scaleY+')';
				video.style.transform = 'scaleX('+scaleX+') scaleY('+scaleY+')';
			}
			
			// agrega el elemento de video a dom
			elem.appendChild( video );
			this.video = video;
			
			// pide al usuario acceso a su cámara
			var self = this;
			this.mediaDevices.getUserMedia({
				"audio": false,
				"video": this.params.constraints || {
					mandatory: {
						minWidth: this.params.dest_width,
						minHeight: this.params.dest_height
					}
				}
			})
			.then( function(stream) {
				// teniendo acceso, adjunta flujo al video
				video.onloadedmetadata = function(e) {
					self.stream = stream;
					self.loaded = true;
					self.live = true;
					self.dispatch('cargar');
					self.dispatch('en vivo');
					self.flip();
				};
				// como la ventana.URL.createObjectURL() está obsoleta, añade una comprobación para que funcione en Safari.
				// los navegadores más antiguos pueden no tener srcObject
				if ("srcObject" in video) {
				  	video.srcObject = stream;
				}
				else {
				  	// usa URL.createObjectURL() como alternativa para los anvegadores más antiguos
				  	video.src = window.URL.createObjectURL(stream);
				}
			})
			.catch( function(err) {
				// JH 2016-07-31 En lugar de enviar un error, ahora vuelve a Flash si userMedia falla (thx @john2014)
				// JH 2016-08-07 Pero solo si flash esta actualmente instalado, si no, envía error aquí y ahora
				if (self.params.enable_flash && self.detectFlash()) {
					setTimeout( function() { self.params.force_flash = 1; self.attach(elem); }, 1 );
				}
				else {
					self.dispatch('error', err);
				}
			});
		}
		else if (this.iOS) {
			// preara los elementos HTML
			var div = document.createElement('div');
			div.id = this.container.id+'-ios_div';
			div.className = 'webcamjs-ios-placeholder';
			div.style.width = '' + this.params.width + 'px';
			div.style.height = '' + this.params.height + 'px';
			div.style.textAlign = 'center';
			div.style.display = 'table-cell';
			div.style.verticalAlign = 'middle';
			div.style.backgroundRepeat = 'no-repeat';
			div.style.backgroundSize = 'contain';
			div.style.backgroundPosition = 'center';
			var span = document.createElement('span');
			span.className = 'webcamjs-ios-text';
			span.innerHTML = this.params.iosPlaceholderText;
			div.appendChild(span);
			var img = document.createElement('img');
			img.id = this.container.id+'-ios_img';
			img.style.width = '' + this.params.dest_width + 'px';
			img.style.height = '' + this.params.dest_height + 'px';
			img.style.display = 'none';
			div.appendChild(img);
			var input = document.createElement('input');
			input.id = this.container.id+'-ios_input';
			input.setAttribute('type', 'file');
			input.setAttribute('accept', 'image/*');
			input.setAttribute('capture', 'camera');
			
			var self = this;
			var params = this.params;
			// agrega el receptor de entrada para cargar la imagen seleccionada
			input.addEventListener('change', function(event) {
				if (event.target.files.length > 0 && event.target.files[0].type.indexOf('image/') == 0) {
					var objURL = URL.createObjectURL(event.target.files[0]);

					// carga la imagen con escala y ajuste automático 
					var image = new Image();
					image.addEventListener('load', function(event) {
						var canvas = document.createElement('canvas');
						canvas.width = params.dest_width;
						canvas.height = params.dest_height;
						var ctx = canvas.getContext('2d');

						// ajusta y pone en escala la imagen para un tamaño final
						ratio = Math.min(image.width / params.dest_width, image.height / params.dest_height);
						var sw = params.dest_width * ratio;
						var sh = params.dest_height * ratio;
						var sx = (image.width - sw) / 2;
						var sy = (image.height - sh) / 2;
						ctx.drawImage(image, sx, sy, sw, sh, 0, 0, params.dest_width, params.dest_height);

						var dataURL = canvas.toDataURL();
						img.src = dataURL;
						div.style.backgroundImage = "url('"+dataURL+"')";
					}, false);
					
					// lee los datos EXIF 
					var fileReader = new FileReader();
					fileReader.addEventListener('load', function(e) {
						var orientation = self.exifOrientation(e.target.result);
						if (orientation > 1) {
							// la imagen necesita ser girada (ve los comentarios en método fixOrientation paara más información)
							// cambia la imagen  y cárgala en objeto de imagen
							self.fixOrientation(objURL, orientation, image);
						} else {
							// carga la información de la imagen en objeto de imagen
							image.src = objURL;
						}
					}, false);
					
					// Convierte la información de la imagen a formato blob
					var http = new XMLHttpRequest();
					http.open("GET", objURL, true);
					http.responseType = "blob";
					http.onload = function(e) {
						if (this.status == 200 || this.status === 0) {
							fileReader.readAsArrayBuffer(this.response);
						}
					};
					http.send();

				}
			}, false);
			input.style.display = 'none';
			elem.appendChild(input);
			// haz un div al que se le pueda dar clic para abrir la interfaz de la cámara
			div.addEventListener('click', function(event) {
				if (params.user_callback) {
					// user_callback global definido - crear la imagen instantánea
					self.snap(params.user_callback, params.user_canvas);
				} else {
					// no hay callback global definido para la imagen instantánea, carga la imagen y espera la llamada del método snap
					input.style.display = 'block';
					input.focus();
					input.click();
					input.style.display = 'none';
				}
			}, false);
			elem.appendChild(div);
			this.loaded = true;
			this.live = true;
		}
		else if (this.params.enable_flash && this.detectFlash()) {
			// alternativa a flash
			window.Webcam = Webcam; // requerida la interfaz flash a js
			var div = document.createElement('div');
			div.innerHTML = this.getSWFHTML();
			elem.appendChild( div );
		}
		else {
			this.dispatch('error', new WebcamError( this.params.noInterfaceFoundText ));
		}
		
		// configura el ajuste final para una vista previa en vivo
		if (this.params.crop_width && this.params.crop_height) {
			var scaled_crop_width = Math.floor( this.params.crop_width * scaleX );
			var scaled_crop_height = Math.floor( this.params.crop_height * scaleY );
			
			elem.style.width = '' + scaled_crop_width + 'px';
			elem.style.height = '' + scaled_crop_height + 'px';
			elem.style.overflow = 'hidden';
			
			elem.scrollLeft = Math.floor( (this.params.width / 2) - (scaled_crop_width / 2) );
			elem.scrollTop = Math.floor( (this.params.height / 2) - (scaled_crop_height / 2) );
		}
		else {
			// si no se ha ajustado, configura el tamaño deseado
			elem.style.width = '' + this.params.width + 'px';
			elem.style.height = '' + this.params.height + 'px';
		}
	},
	
	reset: function() {
		// apaga la cámara, reinicia para conectarla de nuevo
		if (this.preview_active) this.unfreeze();
		
		// intento por solucionar el problema #64
		this.unflip();
		
		if (this.userMedia) {
			if (this.stream) {
				if (this.stream.getVideoTracks) {
					// obten la pista de video para llamar a detenerse en ella
					var tracks = this.stream.getVideoTracks();
					if (tracks && tracks[0] && tracks[0].stop) tracks[0].stop();
				}
				else if (this.stream.stop) {
					// obsoleto, puede ser removido en el futuro
					this.stream.stop();
				}
			}
			delete this.stream;
			delete this.video;
		}

		if ((this.userMedia !== true) && this.loaded && !this.iOS) {
			// llamada para apagar el flash de la cámara
			var movie = this.getMovie();
			if (movie && movie._releaseCamera) movie._releaseCamera();
		}

		if (this.container) {
			this.container.innerHTML = '';
			delete this.container;
		}
	
		this.loaded = false;
		this.live = false;
	},
	
	set: function() {
		// establece uno o más parámetros
		// lista de argumentos variables: 1 param = hash, 2 params = clave, valores
		if (arguments.length == 1) {
			for (var key in arguments[0]) {
				this.params[key] = arguments[0][key];
			}
		}
		else {
			this.params[ arguments[0] ] = arguments[1];
		}
	},
	
	on: function(name, callback) {
		// establece el hook al callback
		name = name.replace(/^on/i, '').toLowerCase();
		if (!this.hooks[name]) this.hooks[name] = [];
		this.hooks[name].push( callback );
	},
	
	off: function(name, callback) {
		// remuevo el hook al callback
		name = name.replace(/^on/i, '').toLowerCase();
		if (this.hooks[name]) {
			if (callback) {
				// remueve un callback de la lista
				var idx = this.hooks[name].indexOf(callback);
				if (idx > -1) this.hooks[name].splice(idx, 1);
			}
			else {
				// callback sin especificar, entontonces borra todas las callbacks
				this.hooks[name] = [];
			}
		}
	},
	
	dispatch: function() {
		// fire hook callback, pasándole un valor opcional
		var name = arguments[0].replace(/^on/i, '').toLowerCase();
		var args = Array.prototype.slice.call(arguments, 1);
		
		if (this.hooks[name] && this.hooks[name].length) {
			for (var idx = 0, len = this.hooks[name].length; idx < len; idx++) {
				var hook = this.hooks[name][idx];
				
				if (typeof(hook) == 'function') {
					// callback es una función de referencia, llámala directamente
					hook.apply(this, args);
				}
				else if ((typeof(hook) == 'object') && (hook.length == 2)) {
					// callback es el método de instancia de objeto estilo PHP
					hook[0][hook[1]].apply(hook[0], args);
				}
				else if (window[hook]) {
					// callback es el nombre de la función global
					window[ hook ].apply(window, args);
				}
			} // bucle
			return true;
		}
		else if (name == 'error') {
			var message;
			if ((args[0] instanceof FlashError) || (args[0] instanceof WebcamError)) {
				message = args[0].message;
			} else {
				message = "No se puede acceder a la cámara web" + args[0].name + ": " + 
					args[0].message + " " + args[0].toString();
			}

			// gestor de errores predeterminado si no se especifica uno personalizado
			alert("Error en Webcam.js: " + message);
		}
		
		return false; // hook no definido
	},

	setSWFLocation: function(value) {
		// para compatibilidad con versiones anteriores
		this.set('swfURL', value);
	},
	
	detectFlash: function() {
		// regresa a true si el navegador soporta flash, false de lo contrario
		// Cfragmento de código tomado de: https://github.com/swfobject/swfobject
		var SHOCKWAVE_FLASH = "Shockwave Flash",
			SHOCKWAVE_FLASH_AX = "ShockwaveFlash.ShockwaveFlash",
        	FLASH_MIME_TYPE = "application/x-shockwave-flash",
        	win = window,
        	nav = navigator,
        	hasFlash = false;
        
        if (typeof nav.plugins !== "undefined" && typeof nav.plugins[SHOCKWAVE_FLASH] === "object") {
        	var desc = nav.plugins[SHOCKWAVE_FLASH].description;
        	if (desc && (typeof nav.mimeTypes !== "undefined" && nav.mimeTypes[FLASH_MIME_TYPE] && nav.mimeTypes[FLASH_MIME_TYPE].enabledPlugin)) {
        		hasFlash = true;
        	}
        }
        else if (typeof win.ActiveXObject !== "undefined") {
        	try {
        		var ax = new ActiveXObject(SHOCKWAVE_FLASH_AX);
        		if (ax) {
        			var ver = ax.GetVariable("$version");
        			if (ver) hasFlash = true;
        		}
        	}
        	catch (e) {;}
        }
        
        return hasFlash;
	},
	
	getSWFHTML: function() {
		//  Volver HTML para incrustar la película tomada por la cámara web basada en flash		
		var html = '',
			swfURL = this.params.swfURL;
		
		// asegúrate que no esta ejecutando localmente (slash no funcionará)
		if (location.protocol.match(/file/)) {
			this.dispatch('error', new FlashError("Flash no funciona desde el disco local.  Por favor ejecútalo desde un servidor web."));
			return '<h3 style="color:red">ERROR: la alternativa flash de Webcam.js no funciona desde el disco local. Por favor ejecútalo desde un servidor web.</h3>';
		}
		
		// make sure we have flash
		if (!this.detectFlash()) {
			this.dispatch('error', new FlashError("Adobe Flash Player no encontrado.  Favor de instalarlo desde get.adobe.com/flashplayer e intentar de nuevo."));
			return '<h3 style="color:red">' + this.params.flashNotDetectedText + '</h3>';
		}
		
		// establece swfURL por defecto si no hay uno establecido explícitamente
		if (!swfURL) {
			// encuentra nuestra etiqueta de script, y usar esa URL base
			var base_url = '';
			var scpts = document.getElementsByTagName('script');
			for (var idx = 0, len = scpts.length; idx < len; idx++) {
				var src = scpts[idx].getAttribute('src');
				if (src && src.match(/\/webcam(\.min)?\.js/)) {
					base_url = src.replace(/\/webcam(\.min)?\.js.*$/, '');
					idx = len;
				}
			}
			if (base_url) swfURL = base_url + '/webcam.swf';
			else swfURL = 'webcam.swf';
		}
		
		// si esta es la primera visita del usuario, establece flashvar para que el panel de configuración de privacidad de flash se muestre primero
		if (window.localStorage && !localStorage.getItem('visited')) {
			this.params.new_user = 1;
			localStorage.setItem('visited', 1);
		}
		
		// construye flashvars string
		var flashvars = '';
		for (var key in this.params) {
			if (flashvars) flashvars += '&';
			flashvars += key + '=' + escape(this.params[key]);
		}
		
		// construye la etiqueta object/embed 
		html += '<object classid="clsid:d27cdb6e-ae6d-11cf-96b8-444553540000" type="application/x-shockwave-flash" codebase="'+this.protocol+'://download.macromedia.com/pub/shockwave/cabs/flash/swflash.cab#version=9,0,0,0" width="'+this.params.width+'" height="'+this.params.height+'" id="webcam_movie_obj" align="middle"><param name="wmode" value="opaque" /><param name="allowScriptAccess" value="always" /><param name="allowFullScreen" value="false" /><param name="movie" value="'+swfURL+'" /><param name="loop" value="false" /><param name="menu" value="false" /><param name="quality" value="best" /><param name="bgcolor" value="#ffffff" /><param name="flashvars" value="'+flashvars+'"/><embed id="webcam_movie_embed" src="'+swfURL+'" wmode="opaque" loop="false" menu="false" quality="best" bgcolor="#ffffff" width="'+this.params.width+'" height="'+this.params.height+'" name="webcam_movie_embed" align="middle" allowScriptAccess="always" allowFullScreen="false" type="application/x-shockwave-flash" pluginspage="http://www.macromedia.com/go/getflashplayer" flashvars="'+flashvars+'"></embed></object>';
		
		return html;
	},
	
	getMovie: function() {
		// obten la referencia a objeto de película/ incrustar en DOM
		if (!this.loaded) return this.dispatch('error', new FlashError("Flash Movie is not loaded yet"));
		var movie = document.getElementById('webcam_movie_obj');
		if (!movie || !movie._snap) movie = document.getElementById('webcam_movie_embed');
		if (!movie) this.dispatch('error', new FlashError("Cannot locate Flash movie in DOM"));
		return movie;
	},
	
	freeze: function() {
		// muestra la vista previa, congela la cámara
		var self = this;
		var params = this.params;
		
		// elimina la vista previa si ya está activa
		if (this.preview_active) this.unfreeze();
		
		// determina el factor scale
		var scaleX = this.params.width / this.params.dest_width;
		var scaleY = this.params.height / this.params.dest_height;
		
		// Debe desdoblar el contenedor, ya que el lienzo de preview se volteará previamente
		this.unflip();
		
		// calcula el tamaño final de la imagen
		var final_width = params.crop_width || params.dest_width;
		var final_height = params.crop_height || params.dest_height;
		
		// crea un lienzo para realizar la vista previa
		var preview_canvas = document.createElement('canvas');
		preview_canvas.width = final_width;
		preview_canvas.height = final_height;
		var preview_context = preview_canvas.getContext('2d');
		
		// guarda para usarlo despues
		this.preview_canvas = preview_canvas;
		this.preview_context = preview_context;
		
		// scale para el tamaño de la vista previa
		if ((scaleX != 1.0) || (scaleY != 1.0)) {
			preview_canvas.style.webkitTransformOrigin = '0px 0px';
			preview_canvas.style.mozTransformOrigin = '0px 0px';
			preview_canvas.style.msTransformOrigin = '0px 0px';
			preview_canvas.style.oTransformOrigin = '0px 0px';
			preview_canvas.style.transformOrigin = '0px 0px';
			preview_canvas.style.webkitTransform = 'scaleX('+scaleX+') scaleY('+scaleY+')';
			preview_canvas.style.mozTransform = 'scaleX('+scaleX+') scaleY('+scaleY+')';
			preview_canvas.style.msTransform = 'scaleX('+scaleX+') scaleY('+scaleY+')';
			preview_canvas.style.oTransform = 'scaleX('+scaleX+') scaleY('+scaleY+')';
			preview_canvas.style.transform = 'scaleX('+scaleX+') scaleY('+scaleY+')';
		}
		
		// toma una imagen instantánea, pero enciende nuestro callback
		this.snap( function() {
			// agrega una imagen preview a dom y ajusta
			preview_canvas.style.position = 'relative';
			preview_canvas.style.left = '' + self.container.scrollLeft + 'px';
			preview_canvas.style.top = '' + self.container.scrollTop + 'px';
			
			self.container.insertBefore( preview_canvas, self.peg );
			self.container.style.overflow = 'hidden';
			
			// establece un indicador para la captura del usuario (usa preview)
			self.preview_active = true;
			
		}, preview_canvas );
	},
	
	unfreeze: function() {
		// Cancela preview y reanuda la transmisión de video en vivo
		if (this.preview_active) {
			// remueve preview_canvas
			this.container.removeChild( this.preview_canvas );
			delete this.preview_context;
			delete this.preview_canvas;
			
			// quita el indicador
			this.preview_active = false;
			
			// vuelve a doblar si desdoblamos antes
			this.flip();
		}
	},
	
	flip: function() {
		//dobla el contenedor horiz (modo espejo) si se desea
		if (this.params.flip_horiz) {
			var sty = this.container.style;
			sty.webkitTransform = 'scaleX(-1)';
			sty.mozTransform = 'scaleX(-1)';
			sty.msTransform = 'scaleX(-1)';
			sty.oTransform = 'scaleX(-1)';
			sty.transform = 'scaleX(-1)';
			sty.filter = 'FlipH';
			sty.msFilter = 'FlipH';
		}
	},
	
	unflip: function() {
		// desdobla el contenedor horiz (modo espejo) si se desea
		if (this.params.flip_horiz) {
			var sty = this.container.style;
			sty.webkitTransform = 'scaleX(1)';
			sty.mozTransform = 'scaleX(1)';
			sty.msTransform = 'scaleX(1)';
			sty.oTransform = 'scaleX(1)';
			sty.transform = 'scaleX(1)';
			sty.filter = '';
			sty.msFilter = '';
		}
	},
	
	savePreview: function(user_callback, user_canvas) {
		// guarda guarda la vista previa congelada y enciende el callback del usuario
		var params = this.params;
		var canvas = this.preview_canvas;
		var context = this.preview_context;
		
		// renderiza user_canvas si se desea
		if (user_canvas) {
			var user_context = user_canvas.getContext('2d');
			user_context.drawImage( canvas, 0, 0 );
		}
		
		// enciede el callback del usuario si así se desea
		user_callback(
			user_canvas ? null : canvas.toDataURL('image/' + params.image_format, params.jpeg_quality / 100 ),
			canvas,
			context
		);
		
		// remueve preview
		if (this.params.unfreeze_snap) this.unfreeze();
	},
	
	snap: function(user_callback, user_canvas) {
		// usa callback global y canvas si no se definieron como parámetros
		if (!user_callback) user_callback = this.params.user_callback;
		if (!user_canvas) user_canvas = this.params.user_canvas;
		
		// toma una imagen instantánea y regresa los datos uri de la imagen
		var self = this;
		var params = this.params;
		
		if (!this.loaded) return this.dispatch('error', new WebcamError("La cámara web no ha cargado"));
		// si (!this.live) regresa this.dispatch('error', new WebcamError("La cámara todavía no está en vivo"));
		if (!user_callback) return this.dispatch('error', new WebcamError("por favor provee una función callback o canvas para snap()"));
		
		// si tenemos un preview congelado, lo usamos
		if (this.preview_active) {
			this.savePreview( user_callback, user_canvas );
			return null;
		}
		
		// crea un elemento canvas fuera de pantalla para sostener pixeles 
		var canvas = document.createElement('canvas');
		canvas.width = this.params.dest_width;
		canvas.height = this.params.dest_height;
		var context = canvas.getContext('2d');
		
		// dobla canvas horizontalmente si se desea
		if (this.params.flip_horiz) {
			context.translate( params.dest_width, 0 );
			context.scale( -1, 1 );
		}
		
		// crea la función inline, llamada después de cargar la imagen /flash) o inmediatamente (native)
		var func = function() {
			// renderiza la imagen si se necesita (flash)
			if (this.src && this.width && this.height) {
				context.drawImage(this, 0, 0, params.dest_width, params.dest_height);
			}
			
			// ajusta si deseas
			if (params.crop_width && params.crop_height) {
				var crop_canvas = document.createElement('canvas');
				crop_canvas.width = params.crop_width;
				crop_canvas.height = params.crop_height;
				var crop_context = crop_canvas.getContext('2d');
				
				crop_context.drawImage( canvas, 
					Math.floor( (params.dest_width / 2) - (params.crop_width / 2) ),
					Math.floor( (params.dest_height / 2) - (params.crop_height / 2) ),
					params.crop_width,
					params.crop_height,
					0,
					0,
					params.crop_width,
					params.crop_height
				);
				
				// intercambia canvases
				context = crop_context;
				canvas = crop_canvas;
			}
			
			// renderiza user canvas si lo deseas
			if (user_canvas) {
				var user_context = user_canvas.getContext('2d');
				user_context.drawImage( canvas, 0, 0 );
			}
			
			// enciende user callback si lo deseas
			user_callback(
				user_canvas ? null : canvas.toDataURL('image/' + params.image_format, params.jpeg_quality / 100 ),
				canvas,
				context
			);
		};
		
		// toma el marco de la imagen para user.Media o la película flash
		if (this.userMedia) {
			// implementación ative 
			context.drawImage(this.video, 0, 0, this.params.dest_width, this.params.dest_height);
			
			// enciende callback de inmediato
			func();
		}
		else if (this.iOS) {
			var div = document.getElementById(this.container.id+'-ios_div');
			var img = document.getElementById(this.container.id+'-ios_img');
			var input = document.getElementById(this.container.id+'-ios_input');
			// función para gestionar el evento snapshot (llamar a user_callback y restablecer la interfaz)
			iFunc = function(event) {
				func.call(img);
				img.removeEventListener('load', iFunc);
				div.style.backgroundImage = 'none';
				img.removeAttribute('src');
				input.value = null;
			};
			if (!input.value) {
				// si no hay una imagen seleccionada, activa el campo input
				img.addEventListener('load', iFunc);
				input.style.display = 'block';
				input.focus();
				input.click();
				input.style.display = 'none';
			} else {
				// imagen ya seleccionada
				iFunc(null);
			}			
		}
		else {
			// fallback flash
			var raw_data = this.getMovie()._snap();
			
			// renderiza la imagen, enciende callback cuando se complete
			var img = new Image();
			img.onload = func;
			img.src = 'data:image/'+this.params.image_format+';base64,' + raw_data;
		}
		
		return null;
	},
	
	configure: function(panel) {
		// abre el panel de configuración de flash-- esepcíficamente el nombre de la pestaña:
		// "camera", "privacy", "default", "localStorage", "microphone", "settingsManager"
		if (!panel) panel = "camera";
		this.getMovie()._configure(panel);
	},
	
	flashNotify: function(type, msg) {
		//  recibe notificaciones de flash sobre eventos
		switch (type) {
			case 'flashLoadComplete':
				// película cargada exitosamente
				this.loaded = true;
				this.dispatch('load');
				break;
			
			case 'cameraLive':
				// la cámara está en vivo y lista para tomar imágenes
				this.live = true;
				this.dispatch('live');
				break;

			case 'error':
				// error Flash 
				this.dispatch('error', new FlashError(msg));
				break;

			default:
				// captura todos los eventos, por si acaso
				// console.log("webcam flash_notify: " + type + ": " + msg);
				break;
		}
	},
	
	b64ToUint6: function(nChr) {
		// convierte base64 caracter codificado a 6-bit íntegro
		// de: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Base64_encoding_and_decoding
		return nChr > 64 && nChr < 91 ? nChr - 65
			: nChr > 96 && nChr < 123 ? nChr - 71
			: nChr > 47 && nChr < 58 ? nChr + 4
			: nChr === 43 ? 62 : nChr === 47 ? 63 : 0;
	},

	base64DecToArr: function(sBase64, nBlocksSize) {
		// convierte base64 string codificado a Uintarray
		// de: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Base64_encoding_and_decoding
		var sB64Enc = sBase64.replace(/[^A-Za-z0-9\+\/]/g, ""), nInLen = sB64Enc.length,
			nOutLen = nBlocksSize ? Math.ceil((nInLen * 3 + 1 >> 2) / nBlocksSize) * nBlocksSize : nInLen * 3 + 1 >> 2, 
			taBytes = new Uint8Array(nOutLen);
		
		for (var nMod3, nMod4, nUint24 = 0, nOutIdx = 0, nInIdx = 0; nInIdx < nInLen; nInIdx++) {
			nMod4 = nInIdx & 3;
			nUint24 |= this.b64ToUint6(sB64Enc.charCodeAt(nInIdx)) << 18 - 6 * nMod4;
			if (nMod4 === 3 || nInLen - nInIdx === 1) {
				for (nMod3 = 0; nMod3 < 3 && nOutIdx < nOutLen; nMod3++, nOutIdx++) {
					taBytes[nOutIdx] = nUint24 >>> (16 >>> nMod3 & 24) & 255;
				}
				nUint24 = 0;
			}
		}
		return taBytes;
	},
	
	upload: function(image_data_uri, target_url, callback) {
		// envía la información de la imagen al servidor usndo AJAX binario
		var form_elem_name = this.params.upload_name || 'webcam';
		
		// detecta el formato de la imagen con uri image_data
		var image_fmt = '';
		if (image_data_uri.match(/^data\:image\/(\w+)/))
			image_fmt = RegExp.$1;
		else
			throw "No se puede localizar la imagen con información URI";
		
		// Data URI extrae datos base64 sin procesar de información URI
		var raw_image_data = image_data_uri.replace(/^data\:image\/\w+\;base64\,/, '');
		
		// utiliza objeto AJAX con el constructon
		var http = new XMLHttpRequest();
		http.open("POST", target_url, true);
		
		// configuración delos eventos progresivos
		if (http.upload && http.upload.addEventListener) {
			http.upload.addEventListener( 'progress', function(e) {
				if (e.lengthComputable) {
					var progress = e.loaded / e.total;
					Webcam.dispatch('uploadProgress', progress, e);
				}
			}, false );
		}
		
		// encargado del terminado
		var self = this;
		http.onload = function() {
			if (callback) callback.apply( self, [http.status, http.responseText, http.statusText] );
			Webcam.dispatch('uploadComplete', http.status, http.responseText, http.statusText);
		};
		
		// crear un blob y decodifica nuestra base64 a binario
		var blob = new Blob( [ this.base64DecToArr(raw_image_data) ], {type: 'image/'+image_fmt} );
		
		// llena un formulario, para que los servidores puedan recibirlo fácilmente como una carga de archivos estándar
		var form = new FormData();
		form.append( form_elem_name, blob, form_elem_name+"."+image_fmt.replace(/e/, '') );
		
		// envía la información al servidor
		http.send(form);
	}
	
};

Webcam.init();

if (typeof define === 'function' && define.amd) {
	define( function() { return Webcam; } );
} 
else if (typeof module === 'object' && module.exports) {
	module.exports = Webcam;
} 
else {
	window.Webcam = Webcam;
}

}(window));
