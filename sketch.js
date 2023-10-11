camera = document.getElementById("camera");
      
Webcam.attach( camera );      
  Webcam.set({
    width:350,
    height:300,
    image_format : 'png',
    png_quality:90
  });


function gotResult(error, results) {
  if (error) {
    console.error(error);
  } else {
    console.log(results);
    
    /*Escribe el código para 
    1.Almacenar la API de voz en sintetizador variable. 
    2.Almacenar los datos en speak_data variables que queremos que el sistema hable
    3.Usar la función SpeechSynthesisUtterance() para convertir el texto que tenemos guardado en una variable speak_data.
    4.Después usar synth.speak para leer el texto provisto.
    5.Actualizar el nombre del objeto y la exactitud como lo hicimos antes.
    
    
    */
  }
}

function take_snapshot()
{
    Webcam.snap(function(data_uri) {
        document.getElementById("result").innerHTML = '<img id="selfie_image" src="'+data_uri+'"/>';
    });
}

  console.log('ml5 version:', ml5.version);
  
classifier = ml5.imageClassifier('https://teachablemachine.withgoogle.com/models/v_sl95BzE/model.json',modelLoaded);

  function modelLoaded() {
    console.log('¡Modelo cargado!');
  }
      
  function check()
  {
    //Escribe código para almacenar la selfie_image en una variable img y luego usa la función classify() para clasificarla.
  
  }
