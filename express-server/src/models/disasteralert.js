'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class DisasterAlert extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  DisasterAlert.init({
    message: DataTypes.TEXT,
    radius_m: DataTypes.INTEGER,
    weight_penalty: DataTypes.INTEGER,
    received_at: DataTypes.DATE,
    expires_at: DataTypes.DATE
  }, {
    sequelize,
    modelName: 'DisasterAlert',
  });
  return DisasterAlert;
};