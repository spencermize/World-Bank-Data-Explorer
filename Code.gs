/**
 * @OnlyCurrentDoc Limits the script to only accessing the current sheet.
 */

var ADDON_TITLE = 'World Bank Data Explorer';

function onInstall(e) {
  onOpen(e);
}

function onOpen(e) {
  SpreadsheetApp.getUi()
      .createAddonMenu()
      .addItem('Open', 'openDialog')
      .addToUi();
}

function openDialog() {
  var html = HtmlService.createTemplateFromFile('sidebar').evaluate();
  html.setTitle(ADDON_TITLE);
  SpreadsheetApp.getUi().showSidebar(html);
}

//Return a well-formed result from an API query with some basic assumptions
function runQuery(query,stringify,display,args,sheetArgs){
  var url = "http://api.worldbank.org/";
  var format = "?format=json&per_page=30000";
  var dateFilter = "";
  if(args){
    dateFilter = "&date=" + args.startYear + ":" + args.endYear;
  }
  
  var sendQuery = url + query + format + dateFilter;
  var response = "";
  var responseText = UrlFetchApp.fetch(sendQuery);
  var responseJSON = JSON.parse(responseText);
  
  responseJSON[0].query = query;
  
  if(display){
    postToSheet(responseJSON,sheetArgs);
  }
  return JSON.stringify(responseJSON);
}

//Load data to sheet
function postToSheet(response,args){
  var sheet = SpreadsheetApp.getActiveSheet();
  var firstEmptyCol = getFirstEmptyColumn(SpreadsheetApp.getActive());
  var baseCell = sheet.getRange(1,firstEmptyCol);
  var currentCountry = response[1][0].country.value;
  var currentCountryID = response[1][0].country.id;
  var currentIndicator = response[1][0].indicator.id;
  var currentIndicatorText = response[1][0].indicator.value;
  var probablyPercentage = currentIndicatorText.indexOf("%")>0 ? true : false;
  var probablyCurrency = currentIndicatorText.indexOf("$")>0 ? true : false;
  var defaultRow = args.dataStats ? 6 : 4;
  var defaultColumn = firstEmptyCol;
  var rowOffset = 0;
  var colOffset = 0;
  var nCountries = 1;
  
  //default number formatting
  if(probablyPercentage){ //takes precedence in case of %/$ conflict
    var form = "#.00%";
    var negForm = "-#.00%";
  }else if(probablyCurrency){
    var form = "$#,###"
    var negForm = "-$#,###";
  }else{ //what is this?
    var form = "#.00";
    var negForm = "-#.00";

  }
  var formString = form + ";[Red]"+negForm+';""';
  
  //add a "year" column
  var nYears = addYearColumn(response[1],currentCountry,baseCell,defaultRow);
  
  //initialize empty data array
  var data = createArray(nYears,response[1].length / nYears);
  
  //what indicator is this?
  baseCell.setValue(currentIndicatorText).setFontWeight("bold");
  baseCell.offset(1,colOffset).setValue('=HYPERLINK("http://data.worldbank.org/indicator/'+ currentIndicator+'","'+currentIndicator+'")');

  //prepare to add data
  colOffset +=1;
  
  //iterate country data
  response[1].forEach(function(element){
    //we're guessing this data is a percentage for formatting purposes
    if(probablyPercentage){
      element.value = element.value / 100;
    }
  
    //clean up the data a bit
    if(!element.value){
      element.value="";
    }

    //if we're on a new country, then move to the next column!
    if(element.country.value!=currentCountry){
      currentCountry = element.country.value;
      currentCountryID = element.country.id;
      nCountries += 1;
      colOffset += 1;
      rowOffset = 0;
    }
    
    //link to country data
    if(rowOffset == defaultRow){
      baseCell.offset(defaultRow - 2, colOffset).setValue('=HYPERLINK("http://data.worldbank.org/indicator/'+ currentIndicator+'?locations=' + currentCountryID + '","'+currentCountry+'")');
    }    
    
    //add to data array
    data[rowOffset][colOffset - 1] = element.value;

    rowOffset += 1;
  }); 

  //insert the data
  var range = baseCell.offset(defaultRow,1,rowOffset,colOffset);
  range.setValues(data).setNumberFormat(formString).setFontWeight("normal");
  
  //build some sparklines
  if(args.sparklines){
    for (var i = 0; i < nCountries; i++) {
      var sparkA1 = baseCell.offset(defaultRow,i+1,nYears,1).getA1Notation();
      baseCell.offset(defaultRow - 1,i+1).setFormula('sparkline('+sparkA1+',{"linewidth",2;"color","#FFA500";"rtl",true})');
    }
  }
  
  //draw a pretty chart
  if(args.chart){
    drawChart(baseCell.offset(defaultRow - 2,0,nYears + 2,nCountries + 1),{title: currentIndicatorText, type: args.type});
  }
  
  //provide some context!
  if(args.metadata){
    var responseText = UrlFetchApp.fetch("http://api.worldbank.org/indicators/" + currentIndicator + "?format=json");
    var responseJSON = JSON.parse(responseText);
    baseCell.setNote("Source: " + responseJSON[1][0].sourceOrganization + "\n\n" + responseJSON[1][0].sourceNote);
  }
  
  //rate data completeness
  if(args.dataStats){
      var countRange = sheet.getRange(defaultRow, 2, 1, nCountries).getA1Notation();
      var compCell = baseCell.offset(2,1);
      var expectedCells = nCountries*nYears;
      baseCell.offset(2,0).setValue("Countries <2 Data Points").setFontWeight("bold");
      compCell.setFormula('countif(' + countRange +',"#N/A") / ' + nCountries).setNumberFormat("#.00%");
      if(compCell.getValue()>.5){
        compCell.setBackgroundRGB(255, 131, 116);
      }else if(compCell.getValue()>.01){
        compCell.setBackgroundRGB(249, 255, 151);
      }else{
        compCell.setBackgroundRGB(116, 255, 167);
      }
      
      countRange = sheet.getRange(defaultRow, 2, nYears, nCountries).getA1Notation();
      compCell = baseCell.offset(3,1);
      
      baseCell.offset(3,0).setValue("Data Completeness").setFontWeight("bold");
      compCell.setFormula('count(' + countRange +') / ' + expectedCells).setNumberFormat("#.00%");
      
      if(compCell.getValue()<.35){
        compCell.setBackgroundRGB(255, 131, 116);
      }else if(compCell.getValue()<.8){
        compCell.setBackgroundRGB(249, 255, 151);
      }else{
        compCell.setBackgroundRGB(116, 255, 167);
      }
   }
}

function addYearColumn(response,currentCountry,baseCell,rowOffset){
  var nYears = 0;
  var aYears = [];
  for (var i = 0; i < response.length; ++i) {
    element = response[i];
    if(element.country.value==currentCountry){
      aYears.push([element.date]);
      nYears += 1;
    }else{
      break;
    }
  }
  var range = baseCell.offset(rowOffset,0,nYears,1)
  range.setValues(aYears).setNumberFormat("@").setFontWeight("bold");
  return nYears;  
}

function drawChart(range,args){
  var sheet = SpreadsheetApp.getActiveSheet();
  var type = args.type;
  Logger.log(args);
  switch(type) {
    case "BAR":
        type = Charts.ChartType.BAR;
        break;
    case "LINE":
        type = Charts.ChartType.LINE;
        break;
    case "AREA":
        type = Charts.ChartType.AREA;
        break;
    case "SCATTER":
        type = Charts.ChartType.SCATTER;
        break;
  }
  var chart = sheet.newChart()
       .setChartType(type)
       .setPosition(5, 5, 0, 0)
       .addRange(range)
       .setOption("reverseCategories", true)
       .setOption('title', args.title )
       .setOption('titleTextStyle',{
         fontName: "Roboto",
         bold: true,
         fontSize: 18
       })
       .build();
  
   sheet.insertChart(chart);   
}

//Helper functions
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename)
      .getContent();
}

function getFirstEmptyColumn(sheet) {
/**
* Gets first empty column from spreadsheet object
*
* @param {Object} sheet
* @return {Number} total
*/
  var range = sheet.getDataRange();
  var values = range.getValues();
  var valueLength = values.length;
  if(values.length==1){ //empty sheet
    return 1;
  }
  var count = 0;
  var total = 0;
  for (var row=0; row<valueLength; row+=1) {
   for (var col=0; col<values[row].length; col+=1) { 
     count++; 
     if (count > total) {
       total = count;
     }
   }
   count = 0;
  }
return (total+1);
}

function clientLog(msg) {
  Logger.log(msg);
}

function createArray(length) {
    var arr = new Array(Math.ceil(length) || 0),
        i = length;

    if (arguments.length > 1) {
        var args = Array.prototype.slice.call(arguments, 1);
        while(i--) arr[length-1 - i] = createArray.apply(this, args);
    }

    return arr;
}